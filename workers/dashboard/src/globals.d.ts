// wrangler --define replaces this identifier at build time. The deploy
// workflow substitutes the value from the project root package.json so the
// worker's runtime version stays in lockstep with release-please.
declare const VERSION: string;
