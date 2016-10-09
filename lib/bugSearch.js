/**
 * BugSearch is a wrapper for bugzilla interactions. This searches bugs.
 */

const JSONOutput = require('./JSONOutput');

class BugSearch {
  /**
   * BugSearch constructor
   *
   * @param {Array} allBugs already existing bugs or empty if we need to search
   * @param {Object} bugzilla initialized bugzilla object from bz
   */
  constructor(allBugs, bugzilla) {
    this.allBugs = allBugs;
    this.bugzilla = bugzilla;
  }

  /**
   * Takes search params and searches bugzilla for all bugs.
   *
   * @param  {Object} params bugzilla search params
   * @return {Promise}
   */
  getAllBugs(params) {
    return new Promise((resolve, reject) => {
      if (!this.allBugs || this.allBugs.length === 0) {
        console.log('Starting to fetch bugs...');

        this.bugzilla.searchBugs(params, (error, bugs) => {
          if (error) return reject(error);

          const output = new JSONOutput('bugs.json');
          output.save(bugs)
          .then(() => {
            console.log('Bugs saved');

            resolve(this.allBugs);
          })
          .catch((err) => {
            reject(err);
          });
        });
      } else {
        resolve(this.allBugs);
      }
    });
  }
}

module.exports = BugSearch;
