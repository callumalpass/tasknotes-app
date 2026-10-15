/** Vite replaces MODE at compilation. Runtime configuration alone never makes
 * a managed artifact local, and a local artifact cannot select a managed host. */
export const LOCAL_TASKNOTES_BUILD = import.meta.env.MODE === "local-rehearsal";
