// mdflow's and the extractor's versions, as constants: an installed package cannot read
// ../node_modules/defuddle (npm hoists it). verify fails when either drifts from package.json
// or the installed defuddle.
export const VERSION = "0.4.0";
export const EXTRACTOR_VERSION = "0.19.4";
