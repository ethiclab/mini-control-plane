'use strict';

/**
 * Cattura stdout/stderr prodotti da console.log/console.error durante fn().
 * Restituisce { stdout: string, stderr: string }. Supporta fn sincrone e async.
 */
function captureOutput(fn) {
  const logLines = [];
  const errLines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => logLines.push(args.map(String).join(' '));
  console.error = (...args) => errLines.push(args.map(String).join(' '));
  const finish = () => {
    console.log = origLog;
    console.error = origErr;
    return { stdout: logLines.join('\n'), stderr: errLines.join('\n') };
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(finish, finish);
    }
    return finish();
  } catch (e) {
    return finish();
  }
}

module.exports = { captureOutput };
