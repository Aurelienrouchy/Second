/** Account/compartment control balances. Independent pinned opening/boundary,
 * source-set and drain facts are consumed, never inferred from restored rows.
 * All writes below are documentary plans under the existing report only. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {readFinancialRecoveryControl,readFinancialRecoveryPinnedObject} from '../config/recoveryControl';
import {supportHash,supportSourceHash,supportObject} from './supportRequest';
import type {GlobalFinancialScope} from './globalFinancialProvider';
import {GLOBAL_CONTROL_SOURCE_CATALOG,GLOBAL_CONTROL_SOURCE_CATALOG_VERSION,initialGlobalControlSourceCursor,readGlobalControlSourcePage,
  type GlobalControlSourceCursor} from './globalControlBalanceSources';

type Data=FirebaseFirestore.DocumentData;
type Pin={object:string;generation:string;sha256:string};
type Compartment={balanceType:string;openingCents:number;closingCents:number;providerNetCents:number;liabilitiesCents:number;receivablesCents:number;ownFundsCents:number;unknown:boolean};
export type GlobalControlBalanceState={protocol:'global_control_balance_v1';stage:'opening'|'sources'|'events'|'components'|'complete';
  lastFailureReason?:string|null;anchorHash:string|null;anchorPin:Pin|null;openingPin:Pin|null;openingSequence:number;openingCount:number;openingDigest:string;
  sourceCursor:GlobalControlSourceCursor;sourceSets:Record<string,{count:number;digest:string}>;sourcesClosed:boolean;
  eventCursor:string|null;componentCursor:string|null;sourceCount:number;effectCount:number;eventCount:number;componentCount:number;
  eventMismatches:number;componentMismatches:number;unknownCount:number;issues:string[];providerCount:number;providerDigest:string;
  providerUsedCount:number;compartments:Compartment[];result:Data|null};
export const GLOBAL_CONTROL_BALANCE_MODE='global_control_balance_v1' as const;
export const GLOBAL_CONTROL_BALANCE_LIMITS={pageSize:10,issues:40,providerRefs:20} as const;
// BEGIN CODE-BOUND WRITER REGISTRY
/** Approved code-bound writers. Independent drain evidence must name every
 * entry exactly; a self-declared subset cannot establish coverage. Revision
 * manifests are frozen with these module byte hashes, never read from DB. */
export const GLOBAL_CONTROL_WRITER_REGISTRY_VERSION='global_control_writer_registry_v1';
export const GLOBAL_CONTROL_WRITER_REGISTRY = [
  {
    "writerId": "wallet_purchase",
    "revisionHash": "cdfded129ff136a7e78408289dfeb60909bca9ced5ece352f30e002071f40eaf",
    "sourceClassIds": [
      "wallets",
      "ledger",
      "transactions",
      "stripe_checkout_intents"
    ],
    "modules": [
      {
        "path": "functions/src/callable/wallet.ts",
        "sha256": "81cd6c23d51c902a7eff333f0209a156854ecd17fb0c963db31212de019de218"
      },
      {
        "path": "functions/src/utils/walletPurchase.ts",
        "sha256": "88faf573af89e03545572e50d3371aa65139871c375a441144160b97b98c36d8"
      },
      {
        "path": "functions/src/utils/stripeCheckout.ts",
        "sha256": "6e77a65f29b8e99cee5b13e5dd3fabb8591890520b13f63feba2d389d8b89528"
      },
      {
        "path": "functions/src/callable/payments/checkout.ts",
        "sha256": "9cbede933731389c24e54b8dfff0aa918769cde287352d2717e4b493f8bd201e"
      },
      {
        "path": "functions/src/http/stripe/payment.ts",
        "sha256": "ebac5a95d9f304631d855f64c5ea2ac8cbc76c8e5e6f782e885d64061fdc695d"
      },
      {
        "path": "functions/src/utils/fees.ts",
        "sha256": "7f181fc4da9524dfcd1d3083389137a45f5d93ec4ea791db8c17be8d98031a8e"
      },
      {
        "path": "functions/src/config/operatorServiceTax.ts",
        "sha256": "1110bf646c109895da1837380fcdb0d12dc3608d012f80a66d5cbc411edc7e72"
      },
      {
        "path": "functions/src/utils/shippingSourceIdentity.ts",
        "sha256": "30ad41381f0bca16ddf2c619d9da7296a25bc1c8b11d31326e110387a1e5b0b7"
      },
      {
        "path": "functions/src/utils/reservedShippingPurchase.ts",
        "sha256": "0271057bfcfff01538250bb76a0ec189714f51fd70517d1002cae8d0fd795a2d"
      }
    ]
  },
  {
    "writerId": "withdrawal_payout",
    "revisionHash": "992414f817bc934be90837901ff7e1f910431c0ee21e984bf6b083ffb81f64c7",
    "sourceClassIds": [
      "wallets",
      "ledger",
      "withdrawal_requests",
      "failed_operations",
      "admin_alerts"
    ],
    "modules": [
      {
        "path": "functions/src/callable/wallet.ts",
        "sha256": "81cd6c23d51c902a7eff333f0209a156854ecd17fb0c963db31212de019de218"
      },
      {
        "path": "functions/src/utils/payoutRecovery.ts",
        "sha256": "fceeedde50a1e9dd04542739669f208bec2a98a3dcc3c6cd36c25d3d735d0f9c"
      },
      {
        "path": "functions/src/utils/payoutOutcome.ts",
        "sha256": "28eaa0f3d8331ccc9c75c6e09d2236c4ebe4749a26fad189e91be3a3a445a1e8"
      },
      {
        "path": "functions/src/utils/stripeBank.ts",
        "sha256": "63b0f2f515d632477f6988b04d0930f6ab52cb5c96edcc109629afea0ff8dffd"
      },
      {
        "path": "functions/src/http/stripe/payouts.ts",
        "sha256": "eb7935112e552d5601c440434d0586479f0699ab9d4f3386358301cd54cffaa4"
      }
    ]
  },
  {
    "writerId": "purchase_refund",
    "revisionHash": "f0245786668015afb4fbb5be088264cecc96cef6e6eac96c2b0554100b231d9e",
    "sourceClassIds": [
      "wallets",
      "ledger",
      "transactions",
      "refund_allocations",
      "refund_history",
      "refund_repairs",
      "refund_repair_commands",
      "dispute_decisions",
      "disputes",
      "automatic_decisions_log",
      "platform_ledger",
      "failed_operations",
      "admin_alerts"
    ],
    "modules": [
      {
        "path": "functions/src/utils/refund.ts",
        "sha256": "52638ed37fac5e7bc7c89b7801b82000949cd00cd274fd1bbfbd79d5a6ffa934"
      },
      {
        "path": "functions/src/utils/refundDecision.ts",
        "sha256": "89f8981560a9fc96b3f08283e906462488a2c5018098563318431602b08a0fcf"
      },
      {
        "path": "functions/src/utils/refundRepair.ts",
        "sha256": "074bdc5596873826409599e93eda589477fc01dd0c6734a389e0fedce5a8c857"
      },
      {
        "path": "functions/src/utils/returnRefund.ts",
        "sha256": "03e1841f30445fb7457a6b3b348dee227167b6aab7bb44ee97b11a446e2d4f95"
      },
      {
        "path": "functions/src/utils/refundAllocation.ts",
        "sha256": "3c0b0eec69c0f81a40a282bfa4e901b60b5bb5dc27c27f38402a4420d73980cc"
      },
      {
        "path": "functions/src/utils/bankDisputeCase.ts",
        "sha256": "4ab1896f1d6324b923cf09557afb34f27c68f284eae404bc62db386ea2cf2e99"
      },
      {
        "path": "functions/src/callable/payments/disputes.ts",
        "sha256": "ed8882c2fc009b515483aa6758d5fcf3cfa4425114e012432e7191c9b1d3cd20"
      },
      {
        "path": "functions/src/http/stripe/refunds.ts",
        "sha256": "6c7d32ba0a6287e26dfc77c1cfa3097454a5ff484ba4dc1dcb929401bb665e96"
      },
      {
        "path": "functions/src/http/stripe/disputes.ts",
        "sha256": "8647e576add89ed11b3f0d9af20f1d2f7bda365148cfef75a0359b01888b0193"
      },
      {
        "path": "functions/src/callable/devCommerce.ts",
        "sha256": "2ccbd461e3eb907804de34270a5407ba51d8c8f0cb299c24e73976f7627a4b76"
      }
    ]
  },
  {
    "writerId": "escrow_delivery",
    "revisionHash": "9d402167b7938c7e896c4f787817af2a7ccd3e76391b2776ac0e5e08f3f615a2",
    "sourceClassIds": [
      "wallets",
      "ledger",
      "transactions",
      "swaps",
      "topup_release",
      "failed_operations",
      "admin_alerts"
    ],
    "modules": [
      {
        "path": "functions/src/utils/labelFulfillment.ts",
        "sha256": "89ba324da6871d2c5ef25c1453815df1859213dd07f0539ae97595d9cbea8fa6"
      },
      {
        "path": "functions/src/utils/trackingTransition.ts",
        "sha256": "6f2451c46459abc02396d871b534cafff96ce6b133ad27d49c4953f7eef53d69"
      },
      {
        "path": "functions/src/utils/swapHeldFunds.ts",
        "sha256": "3108c0dbb63ada6759a8b9cf5976d66308f96ec839b4352497068c1c051b0faf"
      },
      {
        "path": "functions/src/scheduled/releaseHeldFunds.ts",
        "sha256": "c2ac93442ef52ae72e24eb21ce123f4c8eed9c7145a366e99243c5939adfac29"
      },
      {
        "path": "functions/src/scheduled/trackingCheck.ts",
        "sha256": "e5740e05b5baeb3a04975874a9ee7a241229532ffe5c9333d08b224facf3a25d"
      },
      {
        "path": "functions/src/http/shipEngineWebhook.ts",
        "sha256": "bf29b2ca442b2823f97cdd55226386016293cc1c7a4a4c93c644aa3abec80ee5"
      },
      {
        "path": "functions/src/callable/devCommerce.ts",
        "sha256": "2ccbd461e3eb907804de34270a5407ba51d8c8f0cb299c24e73976f7627a4b76"
      }
    ]
  },
  {
    "writerId": "swap_topup",
    "revisionHash": "b6a10d2a6ed625c936fcbd02f88d45f9630290e3232f763cc74af11baa321893",
    "sourceClassIds": [
      "wallets",
      "ledger",
      "swaps",
      "topup_checkout",
      "topup_checkout_commands",
      "topup_checkout_results",
      "topup_refund",
      "topup_release",
      "platform_ledger"
    ],
    "modules": [
      {
        "path": "functions/src/callable/swaps.ts",
        "sha256": "6e82d589f8b4438a1f11fca32e9d3dfa99c0c813ebbd4fb58a4059c102df7f7f"
      },
      {
        "path": "functions/src/utils/swapTopUpCheckout.ts",
        "sha256": "25908b6124199aa94380a7949130a7221a395a2b50ace6b3cc72f97ce6715bf7"
      },
      {
        "path": "functions/src/utils/swapTopUpRefund.ts",
        "sha256": "c51589b24017a9d9e2f2d8be21a8eb9757ad3b7d6cac226d35912c784662d569"
      },
      {
        "path": "functions/src/http/stripe/swapTopUp.ts",
        "sha256": "a5b3809934142f6d85e45946b6655055b78d5eae6bf6623761539ec402261a39"
      },
      {
        "path": "functions/src/scheduled/swaps.ts",
        "sha256": "fca5e850c67a261107c45165ced77138f5edb4d0b699555cbd121a3b4f627463"
      },
      {
        "path": "functions/src/utils/fees.ts",
        "sha256": "7f181fc4da9524dfcd1d3083389137a45f5d93ec4ea791db8c17be8d98031a8e"
      },
      {
        "path": "functions/src/config/operatorServiceTax.ts",
        "sha256": "1110bf646c109895da1837380fcdb0d12dc3608d012f80a66d5cbc411edc7e72"
      }
    ]
  },
  {
    "writerId": "paid_entitlement",
    "revisionHash": "854e97809a2ca5a63a5d4621aa6ac6566425e2225eaaf2c4c56cf71435be0687",
    "sourceClassIds": [
      "eligibility_audit",
      "platform_ledger",
      "admin_alerts"
    ],
    "modules": [
      {
        "path": "functions/src/callable/shopTier.ts",
        "sha256": "bf25c85b742155a686d59ef5d1342f5da3eae3aea457e751ef035d64186977ca"
      },
      {
        "path": "functions/src/http/stripe/shopTier.ts",
        "sha256": "912b5b910e8ca2b8ea2dddeafe44259f46a5234abaeaaaefe3eee9d6943988b8"
      },
      {
        "path": "functions/src/config/shopTierTax.ts",
        "sha256": "98083cb943b843801dd8bf876c0557a9d674ca3fecf24c92834d861a1109555c"
      },
      {
        "path": "functions/src/config/operatorServiceTax.ts",
        "sha256": "1110bf646c109895da1837380fcdb0d12dc3608d012f80a66d5cbc411edc7e72"
      },
      {
        "path": "functions/src/utils/fees.ts",
        "sha256": "7f181fc4da9524dfcd1d3083389137a45f5d93ec4ea791db8c17be8d98031a8e"
      }
    ]
  },
  {
    "writerId": "label_recourse",
    "revisionHash": "ee706c98837d2d4a716745926a6f71e4fbf38cb6a8262f945c30879b87858971",
    "sourceClassIds": [
      "transactions",
      "label_lifecycle_cases",
      "label_lifecycle_commands",
      "label_lifecycle_entries",
      "failed_operations",
      "admin_alerts"
    ],
    "modules": [
      {
        "path": "functions/src/callable/recourse.ts",
        "sha256": "bc8a00edf2e612ac2ac43509e598ee0b0b30ff36d5f4fd2c8ed8bbe9052b2b33"
      },
      {
        "path": "functions/src/utils/labelLifecycle.ts",
        "sha256": "65424674c2a237ff980febfff1e25ac8ce32f7c3be8b1bec762fbed5629b63f2"
      },
      {
        "path": "functions/src/utils/shippingPurchase.ts",
        "sha256": "49edf78052fe54f39fb21ee7242b78d30bccb62978fe75b811e1b5c78bc91e45"
      },
      {
        "path": "functions/src/callable/payments/shippingPurchase.ts",
        "sha256": "f103f988b5c018bd91a94908c4a6b26baf62322eb4d363be3f3b516635c30518"
      },
      {
        "path": "functions/src/callable/payments/shipping.ts",
        "sha256": "a0ea7d8dc60afbe553bad610903f52f302de7a2fd4b178e0ca3c5d40b0f8f60a"
      },
      {
        "path": "functions/src/scheduled/sweepPendingLabels.ts",
        "sha256": "3fcfdeb600b876870741dc38f6b4a54d92c310b7f12cfb2f1452c6873fb1bf0b"
      }
    ]
  },
  {
    "writerId": "native_agreement_recovery",
    "revisionHash": "fc85ae79efac9e0fb9d5cde6e83ba21f94402432d452d7d4941ecd6898ef537f",
    "sourceClassIds": [
      "wallets",
      "ledger",
      "transactions",
      "swaps",
      "withdrawal_requests",
      "failed_operations",
      "admin_alerts",
      "automatic_decisions_log"
    ],
    "modules": [
      {
        "path": "functions/src/callable/payments/meetup.ts",
        "sha256": "14b9b56fad9828426ce6e0887290a5bcb12875920d275687316641dcfd44a6fd"
      },
      {
        "path": "functions/src/scheduled/transactionExpiration.ts",
        "sha256": "393468d482910332af877e43fcc022d0daad5c7ade5e80a787ac328c29cfe8d4"
      },
      {
        "path": "functions/src/scheduled/reconcile.ts",
        "sha256": "32776b4362160dddc91c74d48df6f9dc3c44c8585e359f758ea3e2f152c9580d"
      },
      {
        "path": "functions/src/scheduled/retryFailedOperations.ts",
        "sha256": "a38fe3b02333d5f9b087c083543e83202d6ddd6dd607a40472dfe9f7d8436616"
      },
      {
        "path": "functions/src/callable/supportRequests.ts",
        "sha256": "77e98455f6930d217e41c0673a22283d4b244ec0d064774b31c2ee2bc44f89d3"
      },
      {
        "path": "functions/src/callable/offers.ts",
        "sha256": "732bdf0c71dce33a0c85aa5c3a14e9ea56f7e4d246d0f7f3367e589f525a26f5"
      },
      {
        "path": "functions/src/callable/shippingOffers.ts",
        "sha256": "01e2497d8d3aae1e31edb123ef88233c35b63811114f445145bfe5a34579a925"
      }
    ]
  },
  {
    "writerId": "exceptional_restitution",
    "revisionHash": "3c7e71c10e0106aa5733d14aba1a869c336f7774e3d231758c64a8d3cab75280",
    "sourceClassIds": [
      "wallets",
      "ledger",
      "transactions",
      "withdrawal_requests",
      "platform_ledger",
      "admin_alerts",
      "exceptional_commands",
      "exceptional_evidence"
    ],
    "modules": [
      {
        "path": "functions/src/utils/exceptionalRestitution.ts",
        "sha256": "6430a1142bd6a13d4868e8ad4327ffa0173b8c4d06d243ac83c81e8d1284c68e"
      },
      {
        "path": "functions/src/utils/exceptionalRestitutionSources.ts",
        "sha256": "3b9626e888a2ad0fea9450196849ecb4cbbb1d45a61bda794d082e6df1b2a0bc"
      },
      {
        "path": "functions/src/callable/payments/disputes.ts",
        "sha256": "ed8882c2fc009b515483aa6758d5fcf3cfa4425114e012432e7191c9b1d3cd20"
      }
    ]
  },
  {
    "writerId": "orphan_capture_refund",
    "revisionHash": "2d2cf23e5be964c5f4e0d41458bc5dcb0a764e0c200461b81d6c372df6ddf9fb",
    "sourceClassIds": [
      "failed_operations",
      "eligibility_audit"
    ],
    "modules": [
      {
        "path": "functions/src/utils/orphanCaptureRefund.ts",
        "sha256": "c4b58a557801a7029ddfc60fa3d00bfa83880aeb2d5a16af4824850af588d192"
      },
      {
        "path": "functions/src/utils/paymentCaptureAnomaly.ts",
        "sha256": "caf55205449b9fcadf3b95aee4fa604561a71a2956f8a8856cd405dafe594286"
      },
      {
        "path": "functions/src/http/stripe/payment.ts",
        "sha256": "ebac5a95d9f304631d855f64c5ea2ac8cbc76c8e5e6f782e885d64061fdc695d"
      },
      {
        "path": "functions/src/http/stripe/redrive.ts",
        "sha256": "4185fe3822bd186079f73793ff798ff37896ff8e18c338c66a611551b271d543"
      },
      {
        "path": "functions/src/callable/payments/disputes.ts",
        "sha256": "ed8882c2fc009b515483aa6758d5fcf3cfa4425114e012432e7191c9b1d3cd20"
      },
      {
        "path": "functions/src/utils/globalControlBalanceSources.ts",
        "sha256": "89de38ce7b4fc5ff370cebef18db7888ac79d70f1fcdad8da5e30574f456866d"
      },
      {
        "path": "functions/src/utils/globalFinancialReconciliation.ts",
        "sha256": "512a04dc5c7c1ecfe25ed22ac099d6681203373e6fcaf689e953b553c6e67929"
      }
    ]
  }
] as const;
export const GLOBAL_CONTROL_WRITER_CONTROL_MODULES = [
  {
    "path": "functions/src/config/recoveryControl.ts",
    "sha256": "b855e6000e1ebf17412247ad66d36f3502005d0adc7ee899d8b1ff81d5851ac7"
  },
  {
    "path": "functions/src/config/financialRecoveryManifest.ts",
    "sha256": "f9f6eaedefcfbbcc1abe0c88f523b2472cf6cfab786f37e9d566dc6e801e7461"
  },
  {
    "path": "functions/src/utils/financialRecoveryInterlock.ts",
    "sha256": "d539f72f3a430d999e2c1b46360c695fd11a89738f85c0ab7977344be5a74284"
  },
  {
    "path": "functions/src/utils/financialRecoverySources.ts",
    "sha256": "8ae4ac279296a8fdfc7ec6b4668fa7f7cc07b7a0d42d75b099f0b8036a24efcc"
  },
  {
    "path": "functions/src/utils/supportRequest.ts",
    "sha256": "23d2981e0b114dabf02512d50153157c93c4bccb8306ea781743fc47a0589901"
  },
  {
    "path": "functions/src/utils/privateAccountSession.ts",
    "sha256": "85d6eb305bd28c18a1fd1961e116a9029d8972746cc9e7c9eedd45281fada5d7"
  },
  {
    "path": "functions/src/utils/accountRelationshipReview.ts",
    "sha256": "d326deb8eb3ca4bc8b0ae7846e10f07a439fea52751cddf835d94dfe5a442049"
  },
  {
    "path": "functions/src/shared/accountStanding.ts",
    "sha256": "75fbf09c7a2621b3183e32bc041aa6af2885630f52f0716b22c21cd14310a890"
  },
  {
    "path": "functions/src/shared/accountSecurity.ts",
    "sha256": "64503356b4071d1f66d655d17be82cd75f2c0e113fe18fba2b9e4238fee182d7"
  },
  {
    "path": "functions/src/config/shippingTransportPolicy.ts",
    "sha256": "9ebab952f2014d26b13dbe23c089d2676122ded87ebadbf4bb8484b5ce2c0262"
  },
  {
    "path": "functions/src/utils/shippingLaunchAdmission.ts",
    "sha256": "9e34c6a68de902addb68d9c46b0f69a660554489fc567ef5151d3127d57ec2f3"
  },
  {
    "path": "functions/src/config/shipEngine.ts",
    "sha256": "e6b16df73151c98a4278519f1b73da9795a47b1ecb077b3f94a8daa09bc3281e"
  },
  {
    "path": "functions/src/utils/shippingPurchaseRate.ts",
    "sha256": "8ae6959d02cfd424413bb892829dd625f6b9a0520992c9abd63ccbb75a851210"
  },
  {
    "path": "functions/src/utils/returnRequest.ts",
    "sha256": "68c9e094639d7c859bce2e57a455a0227263dcdb97d0a627d1c442eacf2750f5"
  },
  {
    "path": "functions/src/utils/paymentCheckoutReconciliation.ts",
    "sha256": "41e2a5d6bc8385f5a5f620951d2a9c6698fcd6ed8a2678c4dea96f2db124b522"
  },
  {
    "path": "functions/src/utils/cashMeetup.ts",
    "sha256": "3a1e1110104a2e9a93b70916f650b8ae1a695a55bb1aae62e0a185b00f104d8e"
  },
  {
    "path": "functions/src/utils/accountSecurityIdentity.ts",
    "sha256": "7c16c9c41b435fb92acf63a7a46902a4dbb878ab68d7f9ebc57548b35a0ed6b6"
  },
  {
    "path": "functions/src/utils/eligibility.ts",
    "sha256": "f41cd042e8fd1766e446cd829fd110340eba0d23d9264b9f305f7d926ef87939"
  },
  {
    "path": "functions/src/callable/accountSecurity.ts",
    "sha256": "00dd847ca9dec57b283d07992a479f26ee13bc64a8045a0d3ba6accde28463b3"
  },
  {
    "path": "functions/src/utils/storedAccountSecuritySession.ts",
    "sha256": "37522e0dc679aa16291bba6b1f5ba7b33a9357391f3ec126b8af2bc0c0409c93"
  },
  {
    "path": "functions/src/utils/connectEligibility.ts",
    "sha256": "03f3b6ac16e07905d2c8c20652a50de49c77db71bc5bb897abe1510d39da9721"
  },
  {
    "path": "functions/src/callable/eligibility.ts",
    "sha256": "9dd35ef724f68068d5dced8f8266ff1aec24bbd4f0f367542845000afc898788"
  },
  {
    "path": "functions/src/http/stripe/redrive.ts",
    "sha256": "4185fe3822bd186079f73793ff798ff37896ff8e18c338c66a611551b271d543"
  },
  {
    "path": "functions/src/utils/platformCashPreflight.ts",
    "sha256": "a0cce5d41b36161365c233f295ac4196fce7db43825f25ecc2c2e19c1d0ca9aa"
  },
  {
    "path": "functions/src/utils/paymentCaptureAnomaly.ts",
    "sha256": "caf55205449b9fcadf3b95aee4fa604561a71a2956f8a8856cd405dafe594286"
  },
  {
    "path": "functions/src/utils/manualRefundSettlement.ts",
    "sha256": "0ddfd110cb71d9b1c8d9ec2571a9af48ba0ecc02be39052ba7320d250becbf00"
  },
  {
    "path": "functions/src/utils/privateSupportCaseEvidence.ts",
    "sha256": "deb53f587af4d539369137be093b78e52f0dec76768a97d162da07c51d0dfdd2"
  },
  {
    "path": "functions/src/utils/walletFundsAdmission.ts",
    "sha256": "2964913c23d00fdf64e20fa685d9eb2d8ae0b77cf1d67c373189e296ae5afa7b"
  },
  {
    "path": "functions/src/callable/users.ts",
    "sha256": "12c8902be641313510c9f5b3696b1e837385b23b3ee44e8f2ac96a2df55d87d5"
  },
  {
    "path": "functions/src/utils/globalControlBalanceSources.ts",
    "sha256": "89de38ce7b4fc5ff370cebef18db7888ac79d70f1fcdad8da5e30574f456866d"
  },
  {
    "path": "functions/src/utils/globalFinancialReconciliation.ts",
    "sha256": "512a04dc5c7c1ecfe25ed22ac099d6681203373e6fcaf689e953b553c6e67929"
  },
  {
    "path": "functions/src/utils/supportActivityCompliance.ts",
    "sha256": "a1df9cdfbfbfe225f7d590c0f533a8503cd62de7eb57577c42b4dbf0f2790591"
  },
  {
    "path": "functions/src/utils/privacyOperationsCore.ts",
    "sha256": "58994e8ccd6a33a8c45e9dea3daed663bf733f380707bf9b41244e5278c507e9"
  },
  {
    "path": "functions/src/utils/privacyOperations.ts",
    "sha256": "30970e4c732f99e12531b87cd1c730b4057245ddab7d4caed2e6d38a6891ca4e"
  },
  {
    "path": "functions/src/utils/privacyCapture.ts",
    "sha256": "59bda812119604eeb1a7af6d1e310da7514e23b1c838a76bd9483a0c2efb3dbc"
  },
  {
    "path": "functions/src/utils/privacyDisposition.ts",
    "sha256": "d8258273d2a83110ce7438566d76503b6785cd688575f7df256088f77361bb07"
  },
  {
    "path": "functions/src/utils/privacyDispositionScope.ts",
    "sha256": "c6df7f94dceebb17e6cbe28ef9cde660670076bb19403bd0a759d410ca1bc7ed"
  },
  {
    "path": "functions/src/utils/privacyRetention.ts",
    "sha256": "fbf72ff907345f0b0486b9a10a607bc857446d37db7a9878b4271337421d4c0e"
  },
  {
    "path": "functions/src/utils/privacyPreservationCatalogue.ts",
    "sha256": "eb4e53b3f4cce2fe661a54dc86e06dac83614e822a865dff83b431b744ba8176"
  },
  {
    "path": "functions/src/utils/authorityRequest.ts",
    "sha256": "e32589f9b39f28da1b701841e56b04b0fa0bf33117a3a5cee1e5d5b74558d1d9"
  },
  {
    "path": "functions/src/utils/supportConfidentiality.ts",
    "sha256": "502d3100c4278f6024fa71375f9d15c56b34d17af13a3ff571f377536e85c4d7"
  },
  {
    "path": "functions/src/utils/businessAdmission.ts",
    "sha256": "17fb0304c46f18581d8de294b259ec49846fcd0f4ae06c79e854f859c191ee46"
  },
  {
    "path": "functions/src/utils/businessCessation.ts",
    "sha256": "dc4878e1b2d76d9349d70ab7464889beb50dff84fb6928eee395ad2b1ae9ea63"
  },
  {
    "path": "functions/src/utils/tradeAdmission.ts",
    "sha256": "aad07f84eab1c5483c3e0012da0d9ff3441af0fefac23d608167b43a42c315f6"
  },
  {
    "path": "functions/src/utils/swapLaunchPolicy.ts",
    "sha256": "fe3624e24e73e26ad46c592d8c280173024ea8397954ff5ef6b62109d76230f0"
  },
  {
    "path": "functions/src/config/firebase.ts",
    "sha256": "c4358f137ecd073b197ef50c7ae7f8ccbfd487b5cbef08f272d8fd452f05d81c"
  },
  {
    "path": "functions/src/utils/financialSubjectTransaction.ts",
    "sha256": "030882cdda85c8a8e4e2bf421e759860b4dc2e6ddf7f8e4151f41833d6500975"
  },
  {
    "path": "functions/src/utils/financialSubjectQualification.ts",
    "sha256": "81d6e3492caabaf2e0ac0c81d2b4a3790055472f3f30feca0f8e38400cac6bd2"
  },
  {
    "path": "functions/src/utils/bankDispute.ts",
    "sha256": "2c1f777ee0e4d305aef93d122e20bb219ea13fa5eee09f034c39a8952211cd70"
  },
  {
    "path": "functions/src/utils/refundState.ts",
    "sha256": "c967c7bf76055ee2e0da7fbdd336e3bab00625bd8ee4456e8c06dd05756dd145"
  },
  {
    "path": "functions/src/utils/withdrawalNonExecution.ts",
    "sha256": "e8c534ba1f17a31e3d818daf2dcdd12ff5d7c5306634afebb4df669af456ff06"
  },
  {
    "path": "functions/src/utils/stripeCheckoutProof.ts",
    "sha256": "721ed547b335711ea38bf75ac15e779c50c5769c27f5be845aeaf7e5740658bd"
  },
  {
    "path": "functions/src/utils/smallBalanceClosure.ts",
    "sha256": "cb03116f3f5c2d2b9ce4ffc9c8dfc60503ac09f96ce1111bffdb8237ded03bc8"
  },
  {
    "path": "functions/src/utils/connectRecoveryIdentity.ts",
    "sha256": "3ac7cfbf0f042977d95d64b2df35746f98652382b37dd19aa4a17355cc11fa82"
  },
  {
    "path": "functions/src/utils/accountControlProof.ts",
    "sha256": "16a6cabb59fbdeae937c1ea5bf8885507fc8c69b03db8072b395ea8ea36d1afa"
  },
  {
    "path": "functions/src/config/runtimeEnvironment.ts",
    "sha256": "4b95cd08ddf5560ccd73cea774ec32074f6b9d21cf6be9a1d644858321de86ad"
  },
  {
    "path": "functions/src/config/stripe.ts",
    "sha256": "4142cb834a04534eccf8d113ffd8747f81e252e27caa463f569445bb25626f28"
  },
  {
    "path": "functions/src/callable/consent.ts",
    "sha256": "d8eac8d42668ae1049dd03753eda03cd40d734dcc8aa496a9ffa308062843212"
  },
  {
    "path": "functions/src/shared/eligibility.ts",
    "sha256": "9cdbfa395f10fc1e3dc96d28ae8f075c72b39975daa96dd132c96b489fa4e9e5"
  },
  {
    "path": "functions/src/utils/sellerActivityDeclaration.ts",
    "sha256": "2d4e4cf8bb3f6dddd69d20c2e13d511f5f403bf2856fb8dc5565cacebb9d9654"
  },
  {
    "path": "functions/src/shared/sellerActivityPolicy.json",
    "sha256": "2212ec3bbd6b45b02e8121665d6891ad04548eca5b153b3c9dabc85b7d5a8be9"
  },
  {
    "path": "functions/src/shared/signupConsentPolicy.json",
    "sha256": "1989315c148d481452365d81b3a6bd132ea666bcfdee040f94d7550b422d4c7f"
  },
  {
    "path": "functions/src/config/devShippingSimulation.ts",
    "sha256": "f1a5c72c5635737332dcf313e0c25b5431b8923810e6fc5a28b9f700b520618f"
  },
  {
    "path": "functions/src/shared/checkoutRedirect.ts",
    "sha256": "6ac3e36d6e5bbecac46bf833c4c0034ed8fd090de428eae854e02948eefda985"
  },
  {
    "path": "functions/src/utils/purchasePolicy.ts",
    "sha256": "2d6e4c6d3acd161423d53249be9a6003b3ce7835cee05eed489f188dd6cd68f8"
  },
  {
    "path": "functions/src/utils/trackingHistory.ts",
    "sha256": "e3d7e6f4ec283f9ea10437a41e1e98b1fbb9e932fd46410d22fa4e860469890d"
  },
  {
    "path": "functions/src/utils/stripeAccount.ts",
    "sha256": "c31441a372378bfee13f0bd9b5c5936e45cff7ddd51ba74f6de079acaca5e09d"
  },
  {
    "path": "functions/src/utils/shippingOffers.ts",
    "sha256": "bb7e2be76742cf2a0970e795bbfc7a1713284eba8b28561a27f66d0873a286a0"
  },
  {
    "path": "functions/src/utils/automaticShippingParcel.ts",
    "sha256": "65b8c2fec1594edbb0ed4476893c3b415c60000e28d27f39996fba368219f394"
  },
  {
    "path": "functions/src/shared/automaticShippingEstimate.ts",
    "sha256": "d65394837cdd8393278055f879baff352ba6c3654e70fc64568188e2f6598fc7"
  },
  {
    "path": "functions/src/utils/localAgreement.ts",
    "sha256": "db9c0e6352199e1e87ad5cb598264bff5d71cb9c86512dc25616209b65d9c312"
  },
  {
    "path": "functions/src/utils/localMeetupCancellation.ts",
    "sha256": "7d84efd26efbf28b605cd79f207686ccc1e48d58ef42dadc82654a76ebf64821"
  },
  {
    "path": "functions/src/utils/cashMeetupContract.ts",
    "sha256": "cb509c08a52fb59a410c31e20149d7c7146027c3577f462a328e207a70f0e84e"
  },
  {
    "path": "functions/src/utils/localCatalogue.ts",
    "sha256": "44aea8eb371ff2192c1c8dd64bca2aa820a0ad123d9a4576bee81304cf85ea2f"
  },
  {
    "path": "functions/src/utils/localArticlePrivacy.ts",
    "sha256": "5a393b8de3217b3c221f55157bead66ee8ab42c150bea469f1bffdf87f1f45b3"
  },
  {
    "path": "functions/src/utils/articlePrivacyContract.ts",
    "sha256": "1d2b4aa7baa438f16f61a5617f3aba8d0ea520b9b63392b8e0311691b8a5bdf3"
  },
  {
    "path": "functions/src/utils/phase1LegacyFence.ts",
    "sha256": "7c34301fc1fc2f180ce77c266b905a5287d327f76a5c8e50cbfb155e0338a91c"
  },
  {
    "path": "functions/src/config/phase1Deployment.ts",
    "sha256": "5967c26521499e8bab9f85c3b78076e955cdb707796e3675cf25d8aa61d9e66e"
  },
  {
    "path": "functions/src/utils/inventoryUnit.ts",
    "sha256": "3caf3b0002be19b1e16337a9fae3f8920ce70101ac7ad59a3c3e2aec880a7c2b"
  },
  {
    "path": "functions/src/utils/articleReservation.ts",
    "sha256": "7fd56d56bf6d7710275aab3a9c1bb03240258cf58ec8af64f40c653d1a817849"
  },
  {
    "path": "functions/src/callable/products.ts",
    "sha256": "2e6e7603d827d9c3461075cf6d6de268c974c83d5226e423338d8c04c68fd948"
  },
  {
    "path": "functions/src/callable/articlePrivacy.ts",
    "sha256": "9b4638723de82c1ebd354192c2b00da84f699a0f6e6bb8792f9349583bf32a1f"
  },
  {
    "path": "functions/src/scheduled/phase1Offers.ts",
    "sha256": "72129dd873d76c000a69fdeed261af86d7049ed378063f3450a6700dbbdf64f3"
  },
  {
    "path": "functions/src/callable/reviews.ts",
    "sha256": "71ab05043d090820d64bd3c673ef775c650ced8223c493a41454b07ec11d197f"
  },
  {
    "path": "functions/src/utils/documentaryProjection.ts",
    "sha256": "60091c8bdebef043558346f4a426fd3b3ca8435622ea066e53c8f11999c8d330"
  },
  {
    "path": "functions/src/triggers/users.ts",
    "sha256": "9a0a0ac66cd77f25fcc694fc929a4d68f750d3b79d0169dad01e412203edf1ae"
  },
  {
    "path": "functions/src/triggers/favorites.ts",
    "sha256": "5dbcbcae40ca510377f7a7ecf0b0b0f57a56f362e2c35cda5fc77c7b735754a9"
  },
  {
    "path": "functions/src/triggers/swaps.ts",
    "sha256": "97b3224e9c1f52ec564d21a68692e66219241fdd04179cbf1bbec380e4ce1ade"
  },
  {
    "path": "functions/src/utils/accountErasure.ts",
    "sha256": "db6fa86d226a1f7e7d14a35641b7e1a491de4f014bd92b8ace3d6f47c6d465a2"
  },
  {
    "path": "functions/src/utils/accountErasureContract.ts",
    "sha256": "7fa754c061eb0ee11bf6e11a8d4accd266dcd789b6d7bd4adc6d214b579c273c"
  },
  {
    "path": "functions/src/utils/accountErasureRuntime.ts",
    "sha256": "6cb1b702b040dcbd023eae1d8b3730d514398f7328fda169502650e30ace046e"
  },
  {
    "path": "functions/src/utils/accountErasureScope.ts",
    "sha256": "de2b78e90a82d8ddf09ee6637d9a4bafc6cd638edeb9a0b764d5209428b605c1"
  },
  {
    "path": "functions/src/utils/accountErasureService.ts",
    "sha256": "296a8278db4f5e821282b52ccb24957d2916789ae0ab28077fd46048eaa73e30"
  },
  {
    "path": "functions/src/utils/accountErasureWorker.ts",
    "sha256": "4aa3891796e803bf592e485b12d75b47c73579089eef75c52471a06d8d1482ce"
  },
  {
    "path": "functions/src/utils/accountErasurePolicy.ts",
    "sha256": "b9d0caec6e550bb2f05b6b367a7add41871edb46f50f7fdf9cd5f3d705f9049e"
  },
  {
    "path": "functions/src/utils/accountErasureProviders.ts",
    "sha256": "da8c7cf1539897900f44884f9b7afe5e940927372f8bd2af0eb7f20de854a61e"
  },
  {
    "path": "functions/src/utils/accountErasureQualification.ts",
    "sha256": "97b46089da9328d9c85b1b0ba5936ebd7c1ef7cedf592cebe212e421ff8cafc4"
  },
  {
    "path": "functions/src/utils/accountErasureArticleDisposal.ts",
    "sha256": "a5e04853f204069f69d8a1def5d5f1fbc73a059d8c398b291e16e37bcb9424ba"
  },
  {
    "path": "functions/src/callable/accountErasureOperations.ts",
    "sha256": "76e22d3c5a54502b4bf66744aab47a3779c1b8ac65423de5dc71537b50bc8654"
  },
  {
    "path": "functions/src/callable/accountErasureAppleWeb.ts",
    "sha256": "08e861ecc8bac589e8428b14208846ce0080a372f3f2986a1cd0a5a1252f95d0"
  },
  {
    "path": "functions/src/shared/accountErasureAppleWeb.ts",
    "sha256": "847eec2727ae49f9c4a64bad124bd0a411ae23e8c2537f9bab656766ac3343b7"
  },
  {
    "path": "functions/src/triggers/accountErasure.ts",
    "sha256": "dcebec83492714fe83bb569a3c64561a8631134c90db9eb68e58fddab905ee88"
  },
  {
    "path": "functions/src/triggers/accountErasureStorage.ts",
    "sha256": "6d1523084bfc3e82f88b13f1e40fd1f24047bd9e8f94f4166fbb2bb704d038db"
  },
  {
    "path": "functions/src/scheduled/accountErasure.ts",
    "sha256": "c5485a234ea571ff82e8b203befd8229260906f7e827f9f31c89c9414f8d4bd4"
  },
  {
    "path": "functions/src/utils/phase1CronPartition.ts",
    "sha256": "0581cfa1e29db60c928a014086000e68b3a7a48c577877ce59d021063e4f654a"
  },
  {
    "path": "functions/src/utils/rateLimit.ts",
    "sha256": "b9baec44d273ad188cd9fd7990cf04b7c0e8b2f6a5ab5613f62d22ee68dd08ae"
  },
  {
    "path": "functions/src/utils/rateLimitScope.ts",
    "sha256": "d262dac68f50ad5b09668d6d3927823ef54221aae8e12d5e0d42c01f382877eb"
  },
  {
    "path": "functions/src/utils/articleMedia.ts",
    "sha256": "82465579a60f806b2f3c4896ea706379d009fe2ff56d685d95ac0a48a141117f"
  },
  {
    "path": "functions/src/utils/reportEvidence.ts",
    "sha256": "228b821ebe299241b722303226738741c03b0c618fd573f12c56656adcb26365"
  },
  {
    "path": "functions/src/callable/shopModeration.ts",
    "sha256": "691c36ce4879accfc66966333b1194093c38567caff61b8f4fe90438982fd79e"
  },
  {
    "path": "functions/src/utils/privateMedia.ts",
    "sha256": "edbb325e327f243dae233de445aabdacf353e6305bc6117fca7308ee99b3194d"
  },
  {
    "path": "functions/src/callable/phase1ReadPorts.ts",
    "sha256": "2daf7a6dd005a13ef1050debac86a7455ba54ade029972fdbfbf6854aea82a33"
  },
  {
    "path": "functions/src/utils/swapDisputeReview.ts",
    "sha256": "a31dc87da02f551429199985ff3f639162d0ddbf20243ca2bf813c2244b026c6"
  },
  {
    "path": "functions/src/utils/swapProofMedia.ts",
    "sha256": "b222868fcd0d02c97eaef5c52e75bdc1855ecd361289215a27a569688bac9df6"
  },
  {
    "path": "functions/src/utils/admissionDecision.ts",
    "sha256": "3ef2b6f224fbdfcd38ea87e55a3f77355916118626e8d55cb5e09692d5ce9680"
  },
  {
    "path": "functions/src/triggers/articles.ts",
    "sha256": "fd2980eb0a4bac16ceaee9cc727968b200e18d92918a831665660477fc331b08"
  }
] as const;
export const GLOBAL_CONTROL_WRITER_REGISTRY_HASH=supportSourceHash({writers:GLOBAL_CONTROL_WRITER_REGISTRY,controls:GLOBAL_CONTROL_WRITER_CONTROL_MODULES});
// END CODE-BOUND WRITER REGISTRY
const safe=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const count=(v:unknown):v is number=>safe(v)&&v>=0;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200;
const balanceTypes=['payments','issuing','refund_and_dispute_prefunding','risk_reserved'];
const plus=(a:number,b:number)=>{const n=a+b;if(!safe(n))throw new HttpsError('resource-exhausted','Le contrôle financier dépasse les entiers sûrs.');return n;};
const fail=()=>new HttpsError('failed-precondition','Les preuves indépendantes du contrôle de balance doivent être rapprochées.');
const point=(v:Data)=>{if(!v||!safe(v.seconds)||v.seconds<1||!count(v.nanoseconds)||v.nanoseconds>=1e9)throw fail();return new Timestamp(v.seconds,v.nanoseconds);};
const eq=(a:unknown,b:unknown)=>supportSourceHash(a)===supportSourceHash(b);
const sub=(rid:string,name:string)=>db.collection('admin_alerts').doc(rid).collection(name);
const sourceClassIds=()=>GLOBAL_CONTROL_SOURCE_CATALOG.map(c=>c.id);
export const globalControlBalanceEnabled=(s:GlobalFinancialScope)=>s.controlBalanceMode===GLOBAL_CONTROL_BALANCE_MODE;
function issue(s:GlobalControlBalanceState,reason:string){s.unknownCount=plus(s.unknownCount,1);if(!s.issues.includes(reason)&&s.issues.length<GLOBAL_CONTROL_BALANCE_LIMITS.issues)s.issues.push(reason);}
function scopeIdentity(s:GlobalFinancialScope){return {accountKind:s.accountKind,accountId:s.accountId,platformAccountId:s.platformAccountId,livemode:s.livemode,currency:s.currency,
  period:s.period,nativeCapture:s.nativeCapture??null};}
function parsePin(raw:unknown):Pin{const p=supportObject(raw,['object','generation','sha256']);if(!text(p.object)||!/^\d{1,25}$/.test(p.generation)||!hash(p.sha256))throw fail();return p as Pin;}
async function pinned(pin:Pin,guard:()=>Promise<unknown>){await guard();const bytes=await readFinancialRecoveryPinnedObject(pin);await guard();
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Data;}catch{throw fail();}}
type Authority={pin:Pin;hash:string;anchor:Data;opening:Data;closing:Data;sourceSet:Data;drain:Data;platformContractHash:string};
/** Configuration is server-owned. No pin, path, key or balance amount is taken
 * from a callable argument or a Firestore report, including after restore. */
async function authority(scope:GlobalFinancialScope,guard:()=>Promise<unknown>):Promise<Authority>{
  let configured:unknown;try{configured=JSON.parse(process.env.GLOBAL_FINANCIAL_CONTROL_BALANCE_PIN??'');}catch{throw fail();}
  const pin=parsePin(configured);await guard();const control=await readFinancialRecoveryControl();await guard();const anchor=await pinned(pin,guard);
  supportObject(anchor,['protocol','anchorId','installationId','firestoreProjectId','firestoreDatabaseId','financialEnvironment','stripePlatformAccountId','epoch','scope',
    'catalogVersion','catalogHash','platformContract','openingBoundaryPin','closingBoundaryPin','sourceSetPin','writerDrainPin','openingComponentsHead','openingComponentsCount','openingComponentsDigest']);
  if(anchor.protocol!=='global_control_balance_anchor_v1'||!hash(anchor.anchorId)||anchor.installationId!==control.installation.installationId||
    anchor.firestoreProjectId!==control.installation.firestoreProjectId||anchor.firestoreDatabaseId!==control.installation.firestoreDatabaseId||
    anchor.financialEnvironment!==control.installation.financialEnvironment||anchor.stripePlatformAccountId!==control.installation.stripePlatformAccountId||
    anchor.stripePlatformAccountId!==scope.platformAccountId||anchor.epoch!==control.control.epoch||anchor.financialEnvironment!==(scope.livemode?'live':'test')||
    !eq(anchor.scope,scopeIdentity(scope))||anchor.catalogVersion!==GLOBAL_CONTROL_SOURCE_CATALOG_VERSION||anchor.catalogHash!==supportSourceHash(GLOBAL_CONTROL_SOURCE_CATALOG)||
    !scope.nativeCapture||scope.nativeCapture.readTime.nanoseconds!==0||scope.nativeCapture.readTime.seconds!==scope.period.toSeconds||
    !count(anchor.openingComponentsCount)||!hash(anchor.openingComponentsDigest))throw fail();
  const contract=supportObject(anchor.platformContract,['protocol','accountId','balanceType','walletCustody','evidenceHash']);
  if(contract.protocol!=='native_platform_contract_v1'||contract.accountId!==scope.platformAccountId||contract.balanceType!=='payments'||contract.walletCustody!=='platform'||!hash(contract.evidenceHash))throw fail();
  const opening=await pinned(parsePin(anchor.openingBoundaryPin),guard),closing=await pinned(parsePin(anchor.closingBoundaryPin),guard),
    sourceSet=await pinned(parsePin(anchor.sourceSetPin),guard),drain=await pinned(parsePin(anchor.writerDrainPin),guard);
  const base=(d:Data,protocol:string)=>{if(d.protocol!==protocol||d.anchorId!==anchor.anchorId||d.installationId!==anchor.installationId||d.epoch!==anchor.epoch||
      d.accountId!==scope.accountId||d.platformAccountId!==scope.platformAccountId||d.livemode!==scope.livemode||d.currency!=='CAD')throw fail();};
  for(const [b,t] of [[opening,new Timestamp(scope.period.fromSeconds,0)],[closing,point(scope.nativeCapture.readTime)]] as [Data,Timestamp][]){
    base(b,'global_control_provider_boundary_v1');if(!point(b.asOf).isEqual(t)||!text(b.providerObservationId)||!hash(b.providerEvidenceHash)||!Array.isArray(b.compartments)||!b.compartments.length||b.compartments.length>4||
      new Set(b.compartments.map((c:Data)=>c.balanceType)).size!==b.compartments.length||b.compartments.some((c:Data)=>!balanceTypes.includes(c.balanceType)||!safe(c.availableCents)||!safe(c.pendingCents)||!safe(c.availableCents+c.pendingCents)))throw fail();
  }
  if(!eq(opening.compartments.map((c:Data)=>c.balanceType).sort(),closing.compartments.map((c:Data)=>c.balanceType).sort()))throw fail();
  base(sourceSet,'global_control_source_set_v1');if(sourceSet.catalogVersion!==anchor.catalogVersion||sourceSet.catalogHash!==anchor.catalogHash||!point(sourceSet.readTime).isEqual(point(scope.nativeCapture.readTime))||
    !Array.isArray(sourceSet.classes)||sourceSet.classes.length!==sourceClassIds().length||new Set(sourceSet.classes.map((c:Data)=>c.classId)).size!==sourceClassIds().length||
    sourceSet.classes.some((c:Data)=>!sourceClassIds().includes(c.classId)||!count(c.count)||!hash(c.digest))||!count(sourceSet.providerMovements?.count)||!hash(sourceSet.providerMovements?.digest))throw fail();
  base(drain,'global_control_writer_drain_v1');if(!point(drain.readTime).isEqual(point(scope.nativeCapture.readTime))||drain.sourceSetHash!==supportSourceHash(sourceSet)||
    drain.registryVersion!==GLOBAL_CONTROL_WRITER_REGISTRY_VERSION||drain.registryHash!==GLOBAL_CONTROL_WRITER_REGISTRY_HASH||!Array.isArray(drain.writers)||drain.writers.length!==GLOBAL_CONTROL_WRITER_REGISTRY.length||
    drain.writers.some((w:Data)=>{const known=GLOBAL_CONTROL_WRITER_REGISTRY.find(v=>v.writerId===w.writerId);return !known||known.revisionHash!==w.revisionHash||!eq(known.sourceClassIds,w.sourceClassIds);})||
    new Set(drain.writers.map((w:Data)=>w.writerId)).size!==drain.writers.length||
    drain.writers.some((w:Data)=>!text(w.writerId)||!hash(w.revisionHash)||!Array.isArray(w.sourceClassIds)||!w.sourceClassIds.length||w.sourceClassIds.some((c:unknown)=>!sourceClassIds().includes(c as string))||
      !point(w.fencedThrough).isEqual(point(scope.nativeCapture!.readTime))||!hash(w.effectBoundaryHash))||
    sourceClassIds().some(c=>!drain.writers.some((w:Data)=>w.sourceClassIds.includes(c)))||drain.openPermitCount!==0||drain.pendingProviderEffectCount!==0||!hash(drain.permitInventoryHash)||!hash(drain.providerEffectInventoryHash))throw fail();
  if(anchor.openingComponentsHead!==null)parsePin(anchor.openingComponentsHead);else if(anchor.openingComponentsCount!==0)throw fail();
  // An epoch/config change during the IO cannot qualify the earlier anchor.
  const after=await readFinancialRecoveryControl();await guard();if(after.control.epoch!==control.control.epoch||!eq(after.installation,control.installation)||
    !eq(parsePin(JSON.parse(process.env.GLOBAL_FINANCIAL_CONTROL_BALANCE_PIN??'')),pin))throw fail();
  return {pin,hash:supportSourceHash(anchor),anchor,opening,closing,sourceSet,drain,platformContractHash:supportSourceHash(contract)};
}
export function initialGlobalControlBalanceState(scope:GlobalFinancialScope):GlobalControlBalanceState|null{
  if(!globalControlBalanceEnabled(scope))return null;
  return {protocol:GLOBAL_CONTROL_BALANCE_MODE,stage:'opening',anchorHash:null,anchorPin:null,openingPin:null,openingSequence:0,openingCount:0,
    openingDigest:supportHash(['global_control_opening_components_v1']),sourceCursor:initialGlobalControlSourceCursor(),sourceSets:{},sourcesClosed:false,
    eventCursor:null,componentCursor:null,sourceCount:0,effectCount:0,eventCount:0,componentCount:0,eventMismatches:0,componentMismatches:0,unknownCount:0,issues:[],
    providerCount:0,providerDigest:supportHash(['global_control_provider_set_v1',scope.accountId,scope.period]),providerUsedCount:0,compartments:[],result:null};
}
function nextState(s:GlobalControlBalanceState):GlobalControlBalanceState{return {...s,lastFailureReason:null,issues:[...s.issues],sourceSets:Object.fromEntries(Object.entries(s.sourceSets).map(([k,v])=>[k,{...v}])),
  compartments:s.compartments.map(c=>({...c}))};}
function bind(s:GlobalControlBalanceState,a:Authority){if(s.anchorHash!==null&&(s.anchorHash!==a.hash||!eq(s.anchorPin,a.pin)))throw fail();
  if(s.anchorHash===null){s.anchorHash=a.hash;s.anchorPin=a.pin;s.openingPin=a.anchor.openingComponentsHead;
    s.compartments=a.opening.compartments.map((c:Data)=>({balanceType:c.balanceType,openingCents:c.availableCents+c.pendingCents,
      closingCents:a.closing.compartments.find((v:Data)=>v.balanceType===c.balanceType).availableCents+a.closing.compartments.find((v:Data)=>v.balanceType===c.balanceType).pendingCents,
      providerNetCents:0,liabilitiesCents:0,receivablesCents:0,ownFundsCents:0,unknown:false}));}}
function componentKey(e:Data){return supportHash([e.accountId,e.balanceType,e.side,e.partition,e.componentId]);}
function emptyComponent(e:Data){return {protocol:'global_control_component_v1',accountId:e.accountId,balanceType:e.balanceType,side:e.side,partition:e.partition,componentId:e.componentId,
  openingCents:null,closingCents:null,deltaCents:0,stockOrigin:'native',unknown:false,stockEffectId:null};}
type Plan={state:GlobalControlBalanceState;entries:Data[];commit:()=>void;reason:string|null};
const unavailable=(s:GlobalControlBalanceState):Plan=>({state:s,entries:[],commit(){},reason:'control_balance_authority_unavailable_or_changed'});
async function tryAuthority(scope:GlobalFinancialScope,guard:()=>Promise<unknown>){try{return await authority(scope,guard);}catch(error){
  if(error instanceof HttpsError&&['unauthenticated','permission-denied'].includes(error.code))throw error;return null;}}
export function globalControlBalanceView(s:GlobalControlBalanceState|null|undefined){return !s?null:{protocol:GLOBAL_CONTROL_BALANCE_MODE,stage:s.stage,
  lastFailureReason:s.lastFailureReason??null,qualification:s.result?.qualification??'incomplete',qualified:s.result?.qualified??false,anchorHash:s.anchorHash,sourceCount:s.sourceCount,effectCount:s.effectCount,
  components:s.componentCount,events:s.eventCount,unknownFacts:s.unknownCount,issues:s.issues,sourceSetVerified:s.result?.sourceSetVerified??false,
  providerSetVerified:s.result?.providerSetVerified??false,writerDrainVerified:s.result?.writerDrainVerified??false,result:s.result,
  financialEffectAuthorized:false,providerMutationAuthorized:false,holdReleaseAuthorized:false,bankArrivalVerified:false,taxPeriodQualified:false,legalStatusVerified:false};}

export function validGlobalControlBalanceState(s:any):s is GlobalControlBalanceState{return s?.protocol===GLOBAL_CONTROL_BALANCE_MODE&&
  ['opening','sources','events','components','complete'].includes(s.stage)&&[s.openingSequence,s.openingCount,s.sourceCount,s.effectCount,s.eventCount,s.componentCount,
  s.eventMismatches,s.componentMismatches,s.unknownCount,s.providerCount,s.providerUsedCount].every(count)&&hash(s.openingDigest)&&hash(s.providerDigest)&&
  Array.isArray(s.issues)&&s.issues.length<=40&&s.issues.every(text)&&Array.isArray(s.compartments)&&s.compartments.length<=4&&
  s.compartments.every((c:any)=>balanceTypes.includes(c.balanceType)&&[c.openingCents,c.closingCents,c.providerNetCents,c.liabilitiesCents,c.receivablesCents,c.ownFundsCents].every(safe))&&
  s.sourceCursor?.catalogVersion===GLOBAL_CONTROL_SOURCE_CATALOG_VERSION&&count(s.sourceCursor.classIndex)&&s.sourceCursor.classIndex<=GLOBAL_CONTROL_SOURCE_CATALOG.length&&
  (s.anchorHash===null||hash(s.anchorHash))&&typeof s.sourcesClosed==='boolean'&&s.sourceSets&&Object.values(s.sourceSets).every((v:any)=>count(v.count)&&hash(v.digest));}
const pageEntry=(entryId:string,kind:string,qualification:string,reasons:string[],extra:Data={})=>({entryId,kind,qualification,reasonCodes:[...new Set(reasons)].slice(0,30),
  source:null,providerMovementId:null,contractReferences:[],amountCents:null,feeCents:null,netCents:null,currency:null,balanceType:null,type:null,reportingCategory:null,...extra});
type HistoricalRead=<T>(fn:(tx:FirebaseFirestore.Transaction)=>Promise<T>)=>Promise<T>;
function sourceSetInitial(classId:string){return {count:0,digest:supportHash(['global_control_source_set_v1',GLOBAL_CONTROL_SOURCE_CATALOG_VERSION,classId])};}
function sourceSetsMatch(s:GlobalControlBalanceState,a:Authority){return a.sourceSet.classes.every((c:Data)=>eq(s.sourceSets[c.classId]??sourceSetInitial(c.classId),{count:c.count,digest:c.digest}));}
function componentIdentity(c:Data,scope:GlobalFinancialScope){return c.accountId===scope.accountId&&balanceTypes.includes(c.balanceType)&&['L','R','K'].includes(c.side)&&text(c.partition)&&text(c.componentId);}
async function componentsPlan(tx:FirebaseFirestore.Transaction,rid:string){const plans=new Map<string,{ref:FirebaseFirestore.DocumentReference;data:Data}>();
  return {plans,get:async(e:Data)=>{const key=componentKey(e);let p=plans.get(key);if(!p){const ref=sub(rid,'control_components').doc(key),raw=(await tx.get(ref)).data();
    if(raw&&(raw.protocol!=='global_control_component_v1'||componentKey(raw)!==key||!safe(raw.deltaCents)))throw fail();p={ref,data:raw?{...raw}:emptyComponent(e)};plans.set(key,p);}return p.data;}};}
/** Only the qualified classifier can delegate this fee. A causal zero is
 * never itself a fee amount. The report stores an exact native PI/charge
 * claim, and the later provider page must supply its own fee evidence. */
function providerFeeClaim(e:Data,row:Data,scope:GlobalFinancialScope){
  const d=e.feeDelegation;if(!d)return null;
  const keys=['protocol','operationId','expectedGrossCents','pricingHash','settlementHash','joinProofHash'];
  if(typeof d!=='object'||Array.isArray(d)||Object.keys(d).length!==keys.length||!keys.every(k=>Object.prototype.hasOwnProperty.call(d,k))||
    d.protocol!=='shop_tier_processor_fee_v1'||!text(d.operationId)||d.operationId.includes('/')||!count(d.expectedGrossCents)||d.expectedGrossCents===0||
    ![d.pricingHash,d.settlementHash,d.joinProofHash].every(hash)||row.classId!=='platform_ledger'||e.side!=='K'||e.partition!=='processor_fee_v1'||
    e.representation!=='causal_evidence'||e.amountCents!==0||e.componentId!==`shop_tier:${d.operationId}:processor_fee`||e.eventId!==`shop_tier:${d.operationId}:capture`||
    e.accountId!==scope.accountId||scope.accountKind!=='platform'||!(e.effectiveAt instanceof Timestamp)||!Array.isArray(e.providerRefs)||e.providerRefs.length!==2)throw fail();
  const pi=e.providerRefs.find((l:Data)=>l.kind==='pi'),ch=e.providerRefs.find((l:Data)=>l.kind==='ch');
  if(!pi||!ch||!/^pi_[A-Za-z0-9_]+$/.test(pi.id)||!/^ch_[A-Za-z0-9_]+$/.test(ch.id)||row.sourcePath!==`platform_ledger/shop_tier_revenue_${pi.id}`)throw fail();
  const identity={...d,eventId:e.eventId,componentId:e.componentId,partition:e.partition,side:e.side,accountId:e.accountId,balanceType:e.balanceType,
    effectiveAt:e.effectiveAt,providerRefs:e.providerRefs,sourcePath:row.sourcePath,sourceHash:row.sourceHash};
  return {key:supportHash(['provider_fee_claim_v1',pi.id,ch.id]),identity};
}
function providerReferencesCorroborated(movement:Data,refs:Data[]){
  const edges=Array.isArray(movement.links)?[{kind:'txn',id:movement.id},...movement.links]:[];
  return refs.every(link=>edges.some((edge:Data)=>edge.kind===link.kind&&edge.id===link.id));
}
/** Every output write is staged. Native reads/joins, pinned IO and current
 * authorization finish before the caller commits this documentary page. */
export async function prepareGlobalControlNativePage(tx:FirebaseFirestore.Transaction,read:HistoricalRead,rid:string,scope:GlobalFinancialScope,
  original:GlobalControlBalanceState,guard:()=>Promise<unknown>,connectedOwnerId:string|null):Promise<Plan>{
  const a=await tryAuthority(scope,guard);if(!a)return unavailable(original);const s=nextState(original);try{bind(s,a);}catch{return unavailable(original);}
  const components=await componentsPlan(tx,rid),entries:Data[]=[],writes:{ref:FirebaseFirestore.DocumentReference;data:Data}[]=[];
  if(s.stage==='opening'){
    if(s.openingPin){let p:Data;try{p=await pinned(s.openingPin,guard);}catch(error){if(error instanceof HttpsError&&['unauthenticated','permission-denied'].includes(error.code))throw error;return unavailable(original);}
      if(p.protocol!=='global_control_opening_components_v1'||p.anchorId!==a.anchor.anchorId||p.sequence!==s.openingSequence||!Array.isArray(p.components)||p.components.length>10||
        !p.components.length&&p.nextPin!==null)throw fail();
      for(const c of p.components){if(!componentIdentity(c,scope)||!safe(c.openingCents)||c.side!=='K'&&c.openingCents<0||!['native','independent'].includes(c.stockOrigin))throw fail();
        const d=await components.get(c);if(d.openingCents!==null)throw fail();d.openingCents=c.openingCents;d.stockOrigin=c.stockOrigin;
        if(c.stockOrigin==='independent'){
          const b=supportObject(c.basis,['protocol','entryId','accountId','balanceType','openingCents','closingCents','openingAt','closingAt','sourceEvidenceHash','derivation']);
          if(c.side==='L'||!safe(c.closingCents)||c.side==='R'&&c.closingCents<0||b.protocol!=='independent_control_component_v1'||!text(b.entryId)||
            b.accountId!==scope.accountId||b.balanceType!==c.balanceType||b.openingCents!==c.openingCents||b.closingCents!==c.closingCents||
            !point(b.openingAt).isEqual(new Timestamp(scope.period.fromSeconds,0))||!point(b.closingAt).isEqual(point(scope.nativeCapture!.readTime))||
            !hash(b.sourceEvidenceHash)||b.derivation!=='independent_entries')throw fail();
          d.closingCents=c.closingCents;d.independentEvidenceHash=supportSourceHash(b);
        }
        s.openingCount=plus(s.openingCount,1);s.openingDigest=supportHash([s.openingDigest,c]);
        entries.push(pageEntry(supportHash(['opening',componentKey(c)]),'native_source','independent_opening_component',[],{amountCents:c.openingCents,currency:'CAD',balanceType:c.balanceType,type:c.partition}));
      }
      s.openingSequence=plus(s.openingSequence,1);s.openingPin=p.nextPin===null?null:parsePin(p.nextPin);
    }
    if(s.openingPin===null){if(s.openingCount!==a.anchor.openingComponentsCount||s.openingDigest!==a.anchor.openingComponentsDigest)throw fail();s.stage='sources';}
  }else if(s.stage==='sources'){
    const page=await read(financial=>readGlobalControlSourcePage(financial,{accountId:scope.accountId,platformAccountId:scope.platformAccountId,accountKind:scope.accountKind,
      livemode:scope.livemode,currency:'CAD',period:scope.period,readTime:point(scope.nativeCapture!.readTime),platformContractHash:a.platformContractHash,connectedOwnerId},s.sourceCursor));
    for(const reason of page.blockers)issue(s,reason);if(page.blockers.length)for(const c of s.compartments)c.unknown=true;
    const eventPlans=new Map<string,{ref:FirebaseFirestore.DocumentReference;data:Data}>();
    const knownEffects=new Map<string,Data|null>(),feeClaims=new Map<string,{ref:FirebaseFirestore.DocumentReference;data:Data}>();
    for(const row of page.rows){
      if(!sourceClassIds().includes(row.classId)||!hash(row.sourceHash)||(typeof row.sourcePath!=='string'||!row.sourcePath||row.sourcePath.length>1536)||!Array.isArray(row.effects))throw fail();
      const set=s.sourceSets[row.classId]??sourceSetInitial(row.classId);s.sourceSets[row.classId]={count:plus(set.count,1),digest:supportHash([set.digest,row.sourcePath,row.sourceHash])};s.sourceCount=plus(s.sourceCount,1);
      for(const reason of row.blockers)issue(s,reason);if(row.blockers.length)for(const c of s.compartments)c.unknown=true;
      entries.push(pageEntry(supportHash(row.sourcePath),'native_source',row.blockers.length?'unknown':'control_source_classified',row.blockers,{source:{path:row.sourcePath,sourceHash:row.sourceHash},type:row.classId}));
      for(const e of row.effects){
        if(!componentIdentity(e,scope)||e.currency!=='CAD'||!hash(e.effectId)||!text(e.eventId)||!safe(e.amountCents)||e.sourcePath!==row.sourcePath||e.sourceHash!==row.sourceHash)throw fail();
        if(e.qualification!=='native_qualified'||e.blockers.length){for(const reason of e.blockers)issue(s,reason);issue(s,'control_effect_unqualified');continue;}
        if(e.representation==='causal_evidence'){
          const claim=providerFeeClaim(e,row,scope);
          if(claim){const ref=sub(rid,'control_provider_fee_claims').doc(claim.key);let p=feeClaims.get(claim.key);
            if(!p){const old=(await tx.get(ref)).data();p={ref,data:old??{protocol:'global_control_provider_fee_claim_v1',identity:claim.identity,appliedMovementId:null}};feeClaims.set(claim.key,p);}
            if(p.data.protocol!=='global_control_provider_fee_claim_v1'||!eq(p.data.identity,claim.identity))issue(s,'provider_fee_native_claim_conflict');
          }
          continue;
        }
        if(e.representation==='period_variation'){
          if(!(e.effectiveAt instanceof Timestamp)){issue(s,'control_effect_time_unknown');continue;}
          const from=new Timestamp(scope.period.fromSeconds,0),to=point(scope.nativeCapture!.readTime);
          if(e.effectiveAt.isEqual(from)||e.effectiveAt.isEqual(to)){issue(s,'boundary_effect_requires_independent_bridge');continue;}
          if(e.effectiveAt.seconds<from.seconds)continue;
          if(e.effectiveAt.seconds>to.seconds||e.effectiveAt.seconds===to.seconds&&e.effectiveAt.nanoseconds>to.nanoseconds){issue(s,'control_effect_after_capture');continue;}
        }
        const ref=sub(rid,'control_effects').doc(supportHash([e.representation,e.effectId]));let prior=knownEffects.get(ref.id);
        if(prior===undefined){prior=(await tx.get(ref)).data()??null;knownEffects.set(ref.id,prior);}
        const expectation=(e as unknown as Data).providerExpectation??null;
        if(expectation){const keys=Object.keys(expectation);
          if(row.classId!=='withdrawal_requests'||e.representation!=='period_variation'||
            !(expectation.kind==='transfer'&&keys.length===2&&keys.includes('destinationAccountId')&&/^acct_[A-Za-z0-9_]+$/.test(expectation.destinationAccountId)&&/:transfer$/.test(e.eventId)&&scope.accountKind==='platform'||
              expectation.kind==='payout'&&keys.length===2&&keys.includes('destinationHash')&&hash(expectation.destinationHash)&&/:payout$/.test(e.eventId)))throw fail();}
        const identity={effectId:e.effectId,eventId:e.eventId,representation:e.representation,component:componentKey(e),amountCents:e.amountCents,
          effectiveAt:e.effectiveAt,providerRefs:e.providerRefs,providerExpectation:expectation};
        if(prior){if(!eq(prior.identity,identity))issue(s,'control_effect_identity_conflict');continue;}
        const data={protocol:'global_control_effect_v1',identity,sourcePath:e.sourcePath,sourceHash:e.sourceHash};knownEffects.set(ref.id,data);writes.push({ref,data});s.effectCount=plus(s.effectCount,1);
        const c=await components.get(e);
        if(e.representation==='closing_stock'){
          if(c.closingCents!==null){c.unknown=true;issue(s,'component_closing_stock_duplicated');}else{c.closingCents=e.amountCents;c.stockEffectId=e.effectId;}
        }else{
          c.deltaCents=plus(c.deltaCents,e.amountCents);const key=supportHash(e.eventId),er=sub(rid,'control_events').doc(key);let p=eventPlans.get(key);
          if(!p){const old=(await tx.get(er)).data();if(old&&(old.eventId!==e.eventId||old.accountId!==scope.accountId||old.balanceType!==e.balanceType||!safe(old.signedCents)||!Array.isArray(old.providerRefs)))throw fail();
            p={ref:er,data:old?{...old,providerRefs:[...old.providerRefs],providerExpectations:[...old.providerExpectations??[]]}:{protocol:'global_control_event_v1',eventId:e.eventId,accountId:scope.accountId,balanceType:e.balanceType,signedCents:0,providerRefs:[],providerExpectations:[],unknown:false}};eventPlans.set(key,p);}
          p.data.signedCents=plus(p.data.signedCents,e.side==='R'?-e.amountCents:e.amountCents);
          if(expectation&&!p.data.providerExpectations.some((v:Data)=>eq(v,expectation))){if(p.data.providerExpectations.length>=20){p.data.unknown=true;issue(s,'event_provider_expectations_saturated');}else p.data.providerExpectations.push(expectation);}
          if(!Array.isArray(e.providerRefs)||e.providerRefs.length>20){p.data.unknown=true;issue(s,'event_provider_references_unbounded');}
          else for(const link of e.providerRefs){if(!text(link.kind)||!text(link.id)){p.data.unknown=true;issue(s,'event_provider_reference_malformed');continue;}
            if(!p.data.providerRefs.some((v:Data)=>v.kind===link.kind&&v.id===link.id)){if(p.data.providerRefs.length>=20){p.data.unknown=true;issue(s,'event_provider_references_saturated');}else p.data.providerRefs.push(link);}}
        }
      }
    }
    for(const p of eventPlans.values())writes.push(p);for(const p of feeClaims.values())writes.push(p);s.sourceCursor=page.next;s.sourcesClosed=page.closed;
    if(page.closed){s.stage='events';if(!sourceSetsMatch(s,a))issue(s,'independent_source_set_mismatch');}
  }else throw fail();
  await guard();return {state:s,entries,reason:null,commit(){for(const p of components.plans.values())tx.set(p.ref,p.data);for(const w of writes)tx.set(w.ref,w.data);}};
}
const movementIdentity=(r:Data)=>Object.fromEntries(['id','sourceId','sourceObject','amountCents','feeCents','netCents','currency','balanceType','type','reportingCategory','createdSeconds','feeDetails','links'].map(k=>[k,r[k]??null]));
/** Provider facts are indexed once per exact native report page. No amount is
 * inferred from an identifier or from a mutable provider status. */
export async function prepareGlobalControlProviderPage(tx:FirebaseFirestore.Transaction,rid:string,scope:GlobalFinancialScope,original:GlobalControlBalanceState,
  rows:Data[],guard:()=>Promise<unknown>):Promise<Plan>{
  const a=await tryAuthority(scope,guard);if(!a)return unavailable(original);const s=nextState(original);try{bind(s,a);}catch{return unavailable(original);}
  const plans=new Map<string,{ref:FirebaseFirestore.DocumentReference;data:Data}>(),feeWrites=new Map<string,{ref:FirebaseFirestore.DocumentReference;data:Data}>(),
    feeEvents=new Map<string,{ref:FirebaseFirestore.DocumentReference;data:Data}>(),components=await componentsPlan(tx,rid);
  for(const row of rows){
    const c=s.compartments.find(v=>v.balanceType===row.balanceType);
    if(!c||row.currency!=='CAD'||!safe(row.netCents)||row.arithmeticQualified!==true||row.providerEdgeQualified!==true||row.reasons?.length){issue(s,'provider_control_movement_unqualified');if(c)c.unknown=true;}
    else c.providerNetCents=plus(c.providerNetCents,row.netCents);
    s.providerCount=plus(s.providerCount,1);s.providerDigest=supportHash([s.providerDigest,row.id,supportSourceHash(movementIdentity(row))]);
    const links=[{kind:'txn',id:row.id},...Array.isArray(row.links)?row.links:[]];
    if(row.sourceObject==='charge'&&row.amountCents>0){
      const pi=links.find((l:Data)=>l.kind==='pi'),ch=links.find((l:Data)=>l.kind==='ch');
      if(pi&&ch){const key=supportHash(['provider_fee_claim_v1',pi.id,ch.id]),ref=sub(rid,'control_provider_fee_claims').doc(key),known=feeWrites.get(ref.path),claim=known?.data??(await tx.get(ref)).data();
        if(claim){
          const n=claim.identity,fee=row.feeCents,from=new Timestamp(scope.period.fromSeconds,0),to=point(scope.nativeCapture!.readTime);
          const valid=claim.protocol==='global_control_provider_fee_claim_v1'&&n?.protocol==='shop_tier_processor_fee_v1'&&n.accountId===scope.accountId&&n.balanceType===row.balanceType&&
            n.expectedGrossCents===row.amountCents&&row.currency==='CAD'&&row.arithmeticQualified===true&&row.providerEdgeQualified===true&&!row.reasons?.length&&
            Array.isArray(n.providerRefs)&&providerReferencesCorroborated(row,n.providerRefs)&&count(fee)&&Array.isArray(row.feeDetails)&&row.feeDetails.length<=30&&
            row.feeDetails.every((f:Data)=>safe(f.amountCents)&&f.currency==='CAD'&&text(f.type))&&row.feeDetails.reduce((sum:number,f:Data)=>plus(sum,f.amountCents),0)===fee&&
            n.effectiveAt instanceof Timestamp&&n.effectiveAt.seconds>=from.seconds&&!(n.effectiveAt.isEqual(from))&&
            (n.effectiveAt.seconds<to.seconds||n.effectiveAt.seconds===to.seconds&&n.effectiveAt.nanoseconds<to.nanoseconds);
          if(!valid)issue(s,'provider_fee_native_edge_amount_or_period_unknown');
          else if(claim.appliedMovementId!==null){if(claim.appliedMovementId!==row.id||claim.providerEvidenceHash!==supportSourceHash(movementIdentity(row)))issue(s,'provider_fee_movement_conflict');}
          else{
            const component=await components.get(n),er=sub(rid,'control_events').doc(supportHash(n.eventId));let event=feeEvents.get(er.path);
            if(!event){const old=(await tx.get(er)).data();if(old)event={ref:er,data:{...old,providerRefs:[...old.providerRefs]}};}
            if(!event||event.data.protocol!=='global_control_event_v1'||event.data.eventId!==n.eventId||event.data.accountId!==scope.accountId||event.data.balanceType!==row.balanceType||!safe(event.data.signedCents))issue(s,'provider_fee_capture_event_missing');
            else if(component.stockEffectId!==null||component.closingCents!==null&&component.closingCents!==-fee||component.openingCents!==0)issue(s,'provider_fee_component_already_covered_or_opening_unknown');
            else{
              const evidenceHash=supportSourceHash({nativeClaim:n,movement:movementIdentity(row)}),effectId=supportHash(['global_control_provider_fee_v1',n.eventId,row.id]);
              component.closingCents=-fee;component.deltaCents=plus(component.deltaCents,-fee);component.stockEffectId=effectId;
              event.data.signedCents=plus(event.data.signedCents,-fee);
              if(!event.data.providerRefs.some((l:Data)=>l.kind==='txn'&&l.id===row.id)){
                if(event.data.providerRefs.length>=20){event.data.unknown=true;issue(s,'event_provider_references_saturated');}else event.data.providerRefs.push({kind:'txn',id:row.id});}
              feeEvents.set(er.path,event);feeWrites.set(ref.path,{ref,data:{...claim,appliedMovementId:row.id,providerEvidenceHash:supportSourceHash(movementIdentity(row)),feeCents:fee,evidenceHash}});
              const proof=sub(rid,'control_effects').doc(effectId);if((await tx.get(proof)).exists)throw fail();
              feeWrites.set(proof.path,{ref:proof,data:{protocol:'global_control_provider_fee_effect_v1',effectId,eventId:n.eventId,componentId:n.componentId,feeCents:fee,effectiveAt:n.effectiveAt,
                representations:['closing_stock','period_variation'],nativeSource:{path:n.sourcePath,sourceHash:n.sourceHash,joinProofHash:n.joinProofHash},providerMovementId:row.id,evidenceHash}});
              s.effectCount=plus(s.effectCount,2);
            }
          }
        }
      }
    }
    for(const link of links){const key=supportHash([link.kind,link.id]);let p=plans.get(key);
      if(!p){const ref=sub(rid,'control_provider_refs').doc(key),raw=(await tx.get(ref)).data();if(raw&&(!Array.isArray(raw.movementIds)||raw.movementIds.length>20||raw.kind!==link.kind||raw.id!==link.id))throw fail();
        p={ref,data:raw?{...raw,movementIds:[...raw.movementIds]}:{kind:link.kind,id:link.id,movementIds:[],saturated:false}};plans.set(key,p);}
      if(!p.data.movementIds.includes(row.id)){if(p.data.movementIds.length>=20){p.data.saturated=true;issue(s,'provider_control_reference_saturated');}else p.data.movementIds.push(row.id);}
    }
  }
  await guard();return {state:s,entries:[],reason:null,commit(){for(const p of plans.values())tx.set(p.ref,p.data);for(const p of components.plans.values())tx.set(p.ref,p.data);for(const p of feeEvents.values())tx.set(p.ref,p.data);for(const p of feeWrites.values())tx.set(p.ref,p.data);}};
}
function finalResult(s:GlobalControlBalanceState,a:Authority){const sourceSetVerified=s.sourcesClosed&&sourceSetsMatch(s,a),providerSetVerified=eq(a.sourceSet.providerMovements,{count:s.providerCount,digest:s.providerDigest});
  if(!sourceSetVerified)issue(s,'independent_source_set_mismatch');if(!providerSetVerified)issue(s,'independent_provider_set_mismatch');
  const unmatched=plus(s.providerCount,-s.providerUsedCount);if(unmatched!==0)issue(s,'provider_control_movements_not_uniquely_bridged');
  const compartments=s.compartments.map(c=>{const flow=plus(plus(c.closingCents,-c.openingCents),-c.providerNetCents),residual=plus(plus(plus(c.closingCents,c.receivablesCents),-c.liabilitiesCents),-c.ownFundsCents);
    return {balanceType:c.balanceType,openingBalanceCents:c.openingCents,closingBalanceCents:c.closingCents,providerNetCents:c.providerNetCents,
      flowDifferenceCents:c.unknown?null:flow,liabilitiesCents:c.unknown?null:c.liabilitiesCents,receivablesCents:c.unknown?null:c.receivablesCents,
      ownFundsCents:c.unknown?null:c.ownFundsCents,residualCents:c.unknown?null:residual};});
  const mismatch=s.componentMismatches>0||s.eventMismatches>0||compartments.some(c=>c.flowDifferenceCents!==null&&c.flowDifferenceCents!==0||c.residualCents!==null&&c.residualCents!==0),
    unknown=s.unknownCount>0||compartments.some(c=>c.residualCents===null)||!sourceSetVerified||!providerSetVerified||unmatched!==0;
  return {protocol:'global_control_balance_result_v1',qualification:unknown?'unknown':mismatch?'mismatch':'balanced',qualified:!unknown&&!mismatch,
    sourceSetVerified,providerSetVerified,writerDrainVerified:true,compartments,componentMismatches:s.componentMismatches,eventMismatches:s.eventMismatches,
    unmatchedProviderMovements:unmatched,financialEffectAuthorized:false,providerMutationAuthorized:false,holdReleaseAuthorized:false};
}
export async function prepareGlobalControlAuditPage(tx:FirebaseFirestore.Transaction,rid:string,scope:GlobalFinancialScope,original:GlobalControlBalanceState,guard:()=>Promise<unknown>):Promise<Plan>{
  const a=await tryAuthority(scope,guard);if(!a)return unavailable(original);const s=nextState(original);try{bind(s,a);}catch{return unavailable(original);}
  const events=s.stage==='events';if(!events&&s.stage!=='components')throw fail();
  let q:FirebaseFirestore.Query=sub(rid,events?'control_events':'control_components').orderBy('__name__').limit(11);const cursor=events?s.eventCursor:s.componentCursor;if(cursor)q=q.startAfter(cursor);
  const page=await tx.get(q),selected=page.docs.slice(0,10),entries:Data[]=[],writes:{ref:FirebaseFirestore.DocumentReference;data:Data}[]=[],usage=new Map<string,Data|null>();
  for(const doc of selected){const d=doc.data();let reasons:string[]=[];
    if(events){if(d.protocol!=='global_control_event_v1'||d.accountId!==scope.accountId||!safe(d.signedCents)||!Array.isArray(d.providerRefs)||d.providerRefs.length>20)throw fail();
      if(d.unknown)reasons.push('event_components_unknown');let movement:Data|null=null;
      if(d.providerRefs.length){let ids:string[]=[];
        for(const kind of ['txn','re','trr','po','tr','ch','pi']){const refs=d.providerRefs.filter((v:Data)=>v.kind===kind);if(!refs.length)continue;
          for(const link of refs){const index=(await tx.get(sub(rid,'control_provider_refs').doc(supportHash([link.kind,link.id])))).data();if(index?.saturated)reasons.push('provider_control_reference_saturated');ids.push(...index?.movementIds??[]);}break;}
        ids=[...new Set(ids)];if(ids.length!==1)reasons.push('event_provider_movement_not_unique');else{
          const mr=(await tx.get(sub(rid,'movements').doc(ids[0]))).data();movement=mr?.provider??null;
          if(!movement||movement.currency!=='CAD'||movement.balanceType!==d.balanceType||!safe(movement.netCents)||movement.arithmeticQualified!==true||movement.providerEdgeQualified!==true||movement.reasons?.length)reasons.push('event_provider_movement_unqualified');
          // An index is a locator, not an association proof. The selected
          // movement's qualified object edges must corroborate EVERY native
          // reference, including less selective PI/charge references. A PI may
          // also index other captures/refunds: no equality of index sets is
          // required, only membership in THIS exact provider object edge.
          if(!movement||!providerReferencesCorroborated(movement,d.providerRefs))reasons.push('native_provider_reference_conflict');
          const expectations=d.providerExpectations??[];
          if(!Array.isArray(expectations)||expectations.length>20||expectations.some((v:Data)=>
            v.kind==='transfer'?movement?.facts?.destinationAccountId!==v.destinationAccountId:
              v.kind==='payout'?movement?.facts?.destinationHash!==v.destinationHash:true))reasons.push('native_provider_destination_conflict');
          const ur=sub(rid,'control_provider_usage').doc(supportHash(ids[0]));let u=usage.get(ur.id);if(u===undefined){u=(await tx.get(ur)).data()??null;usage.set(ur.id,u);}
          if(u&&u.eventId!==d.eventId)reasons.push('provider_movement_used_by_multiple_events');
          else if(!u){const data={movementId:ids[0],eventId:d.eventId};usage.set(ur.id,data);writes.push({ref:ur,data});s.providerUsedCount=plus(s.providerUsedCount,1);}
        }
      }
      const expected=d.providerRefs.length?movement?.netCents:null;
      if(d.providerRefs.length&&expected==null)reasons.push('event_provider_cash_unknown');
      else if(d.signedCents!==(d.providerRefs.length?expected:0))reasons.push('individual_event_cash_bridge_mismatch');
      if(reasons.some(reason=>['native_provider_reference_conflict','native_provider_destination_conflict','event_provider_movement_unqualified','event_provider_cash_unknown'].includes(reason))){
        const compartment=s.compartments.find(c=>c.balanceType===d.balanceType);if(compartment)compartment.unknown=true;issue(s,'native_provider_edge_unqualified');}
      if(reasons.length)s.eventMismatches=plus(s.eventMismatches,1);s.eventCount=plus(s.eventCount,1);
      entries.push(pageEntry(doc.id,'reference_audit',reasons.length?'unknown':'control_event_bridged',reasons,{contractReferences:[d.eventId],netCents:d.signedCents,currency:'CAD',balanceType:d.balanceType}));
    }else{if(d.protocol!=='global_control_component_v1'||!componentIdentity(d,scope)||!safe(d.deltaCents))throw fail();const compartment=s.compartments.find(c=>c.balanceType===d.balanceType);
      if(!compartment)throw fail();
      if(!safe(d.openingCents)||!safe(d.closingCents)||d.unknown){reasons.push('component_opening_or_closing_unproved');compartment.unknown=true;issue(s,'component_opening_or_closing_unproved');}
      else{
        if(plus(d.openingCents,d.deltaCents)!==d.closingCents)reasons.push('individual_component_bridge_mismatch');
        if(d.side==='L')compartment.liabilitiesCents=plus(compartment.liabilitiesCents,d.closingCents);else if(d.side==='R')compartment.receivablesCents=plus(compartment.receivablesCents,d.closingCents);else compartment.ownFundsCents=plus(compartment.ownFundsCents,d.closingCents);
      }
      if(reasons.length)s.componentMismatches=plus(s.componentMismatches,1);s.componentCount=plus(s.componentCount,1);
      entries.push(pageEntry(doc.id,'source_audit',reasons.length?'unknown':'control_component_bridged',reasons,{amountCents:safe(d.closingCents)?d.closingCents:null,currency:'CAD',balanceType:d.balanceType,type:d.partition}));
    }
  }
  const closed=page.size<=10,last=closed?null:selected.at(-1)!.id;
  if(events){s.eventCursor=last;if(closed)s.stage='components';}else{s.componentCursor=last;if(closed){s.stage='complete';s.result=finalResult(s,a);}}
  await guard();return {state:s,entries,reason:null,commit(){for(const w of writes)tx.set(w.ref,w.data);}};
}
