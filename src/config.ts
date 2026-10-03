/**
 * The back end this build talks to. Every value comes from the build
 * environment (VITE_*), so a clone or fork ships with none: the game then
 * runs on the records kept on the device and sends no scores.
 *
 * Where the live values are:
 *   - GitHub Pages: repository variables, read by .github/workflows/deploy.yml.
 *     Forks do not inherit them.
 *   - This machine: .env.local, gitignored, written by `make env` from the
 *     Terraform outputs in infra/. The pixel URL beside them is read by
 *     index.html, not here.
 */
const env = import.meta.env;

/** Base URL of the records API (infra/records.tf). */
export const RECORDS_API: string = env.VITE_RECORDS_API ?? '';
/** The cached leaderboard, GET /board through CloudFront. */
export const BOARD_URL: string = env.VITE_BOARD_URL ?? '';

/** Global records exist only when the build names a back end. */
export const RECORDS_ON = RECORDS_API !== '' && BOARD_URL !== '';
