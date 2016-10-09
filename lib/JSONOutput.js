/**
 * JSONOutput
 */

const fs = require('fs-extra');

class JSONOutput {
  /**
   * JSONOutput constructor
   *
   * @param {String} fileName filename to save JSON to
   */
  constructor(fileName) {
    this.fileName = fileName;
  }

  /**
   * Saves the content to a JSON.
   *
   * @param {Object} content content to write to a file
   */
  save(content) {
    console.log('Writing all difference to alldifferences.json');

    return new Promise((resolve, reject) => {
      fs.outputJson(this.fileName, content, (err) => {
        if (err) return reject(err);

        return resolve();
      });
    });
  }
}

module.exports = JSONOutput;
