/** The shape of the code, as rules. `npm run arch` fails if an import goes the wrong way. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Modules that import each other cannot be understood, or changed, one at a time.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-imports-nothing-of-ours',
      severity: 'error',
      comment:
        'shared/ is the contract. The app and the server both depend on it, so it cannot depend on either.',
      from: { path: '^shared/', pathNot: '\\.test\\.ts$' },
      to: { path: '^(src|server)/' },
    },
    {
      name: 'domain-is-plain',
      severity: 'error',
      comment:
        'src/domain holds the rules. No Vue, no stores, no network: it must be testable with nothing set up.',
      from: { path: '^src/domain/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(net|stores|components|views|telemetry|services)', pathNot: '^src/(domain)/' },
    },
    {
      name: 'domain-does-not-use-frameworks',
      severity: 'error',
      from: { path: '^src/domain/', pathNot: '\\.test\\.ts$' },
      to: { path: '^node_modules/(vue|pinia|vue-router)(/|$)' },
    },
    {
      name: 'net-does-not-know-the-ui',
      severity: 'error',
      comment: 'src/net talks to the deployment. It must not know about Vue, stores or screens.',
      from: { path: '^src/net/', pathNot: '\\.test\\.ts$' },
      to: { path: ['^src/(stores|components|views)/', '^node_modules/(vue|pinia|vue-router)(/|$)'] },
    },
    {
      name: 'stores-do-not-know-screens',
      severity: 'error',
      from: { path: '^src/stores/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/(components|views)/' },
    },
    {
      name: 'components-do-not-reach-the-network',
      severity: 'error',
      comment: 'Components ask stores. Only stores and services decide how data is fetched.',
      from: { path: '^src/(components|views)/' },
      to: { path: '^src/net/(?!api\\.ts)' },
    },
    {
      name: 'server-uses-shared-not-the-app',
      severity: 'error',
      from: { path: '^server/', pathNot: '\\.test\\.ts$' },
      to: { path: '^src/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test\\.ts$|^src/test/' },
    moduleSystems: ['es6'],
  },
};
