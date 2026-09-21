// Lets modules offer links to each other without importing each other. The web module
// registers a result-page builder here; the testing module asks for one when posting a result.
let resultLinker = null;

export const setResultLinker = (fn) => {
  resultLinker = fn;
};

/** A public URL for a test result, or null when the website is off or not published. */
export const resultLink = (guildId, testId) => resultLinker?.(guildId, testId) ?? null;
