// ***********************************************************
// This file is processed and loaded automatically before your test files.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

import '@cypress/code-coverage/support'

import { Eip1193Bridge } from '@ethersproject/experimental/lib/eip1193-bridge'
import assert from 'assert'
import { Network } from 'cypress-hardhat/lib/browser'

import { FeatureFlag } from '../../src/featureFlags/flags/featureFlags'
import { UserState } from '../../src/state/user/reducer'
import { CONNECTED_WALLET_USER_STATE } from '../utils/user-state'
import { injected } from './ethereum'
import { HardhatProvider } from './hardhat'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface ApplicationWindow {
      ethereum: Eip1193Bridge
      hardhat: HardhatProvider
    }
    interface VisitOptions {
      serviceWorker?: true
      featureFlags?: Array<FeatureFlag>
      /**
       * The mock ethereum provider to inject into the page.
       * @default 'goerli'
       */
      // TODO(INFRA-175): Migrate all usage of 'goerli' to 'hardhat'.
      ethereum?: 'goerli' | 'hardhat'
      /**
       * Initial user state.
       * @default {@type import('../utils/user-state').CONNECTED_WALLET_USER_STATE}
       */
      userState?: Partial<UserState>
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface Chainable<Subject> {
      task(event: 'hardhat'): Chainable<Network>
    }
  }
}

// sets up the injected provider to be a mock ethereum provider with the given mnemonic/index
// eslint-disable-next-line no-undef
Cypress.Commands.overwrite(
  'visit',
  (original, url: string | Partial<Cypress.VisitOptions>, options?: Partial<Cypress.VisitOptions>) => {
    assert(typeof url === 'string')

    // Add a hash in the URL if it is not present (to use hash-based routing correctly with queryParams).
    let hashUrl = url.startsWith('/') && url.length > 2 && !url.startsWith('/#') ? `/#${url}` : url
    if (options?.ethereum === 'goerli') hashUrl += `${url.includes('?') ? '&' : '?'}chain=goerli`

    return cy
      .intercept('/service-worker.js', options?.serviceWorker ? undefined : { statusCode: 404 })
      .task('hardhat')
      .then((network) =>
        original({
          ...options,
          url: hashUrl,
          onBeforeLoad(win) {
            options?.onBeforeLoad?.(win)

            // We want to test from a clean state, so we clear the local storage (which clears redux).
            win.localStorage.clear()

            // Set initial user state.
            win.localStorage.setItem(
              'redux_localstorage_simple_user', // storage key for the user reducer using 'redux-localstorage-simple'
              JSON.stringify(options?.userState ?? CONNECTED_WALLET_USER_STATE)
            )

            // Set feature flags, if configured.
            if (options?.featureFlags) {
              const featureFlags = options.featureFlags.reduce((flags, flag) => ({ ...flags, [flag]: 'enabled' }), {})
              win.localStorage.setItem('featureFlags', JSON.stringify(featureFlags))
            }

            // Inject the mock ethereum provider.
            if (options?.ethereum === 'hardhat') {
              // The provider is exposed via hardhat to allow mocking / network manipulation.
              win.hardhat = new HardhatProvider(network)
              win.ethereum = win.hardhat
            } else {
              win.ethereum = injected
            }
          },
        })
      )
  }
)

beforeEach(() => {
  // Infura security policies are based on Origin headers.
  // These are stripped by cypress because chromeWebSecurity === false; this adds them back in.
  cy.intercept(/infura.io/, (res) => {
    res.headers['origin'] = 'http://localhost:3000'
    res.alias = res.body.method
    res.continue()
  })

  // Graphql security policies are based on Origin headers.
  // These are stripped by cypress because chromeWebSecurity === false; this adds them back in.
  cy.intercept('https://api.uniswap.org/v1/graphql', (res) => {
    res.headers['origin'] = 'https://app.uniswap.org'
    res.continue()
  })
  cy.intercept('https://beta.api.uniswap.org/v1/graphql', (res) => {
    res.headers['origin'] = 'https://app.uniswap.org'
    res.continue()
  })

  cy.intercept('https://api.uniswap.org/v1/amplitude-proxy', (res) => {
    res.reply(JSON.stringify({}))
  })
})

Cypress.on('uncaught:exception', () => {
  // returning false here prevents Cypress from failing the test
  return false
})
