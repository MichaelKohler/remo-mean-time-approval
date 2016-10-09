/**
 * BugAnalyzer analyzes the given bugs and prepares for output.
 */

const _ = require('lodash');
const async = require('async');
const Duration = require('duration');

const Difference = require('./difference');

class BugAnalyzer {
  /**
   * BugAnalyzer constructor
   *
   * @param {Object}  bugzilla   initialized bugzilla object from bz
   */
  constructor(bugzilla) {
    this.bugzilla = bugzilla;
    this.bugs = [];
    this.differences = [];
    this.processErrors = [];
  }

  /**
   * Processes all given bugs to search for remo-approval? and remo-approval+
   * and remo-review.
   *
   * @param {Array} bugs bugs to analyze
   *
   * @return {Promise}
   */
  processHistoryForAllBugs(bugs) {
    this.bugs = bugs;

    console.log('Number of bugs: ', this.bugs.length);

    return new Promise((resolve, reject) => {
      // We need to use eachSeries, otherwise we are sending too many
      // requests to bugzilla at once
      async.eachSeries(this.bugs, (bug, callback) => {
        // We reject the promis inside processBugHistory if the bugzilla
        // client responded with an error. Due to network errors etc it might
        // not get that far though and throw a SyntaxError, we are catching it here
        try {
          this.processBugHistory(bug, callback);
        } catch(err) {
          this.processErrors.push({
            error: err,
            bugId: bug.id
          });
        }
      }, (err) => {
        if (err) return reject(err);

        console.log('Finished processing all requested bugs...');
        console.log('Number of added bugs:', this.differences.length);

        this.processEncounteredErrors();
        this.calculateTimes();

        return resolve(this.differences)
      });
    });
  }

  /**
   * Calculates the mean times and pushes it as last row to the differences.
   * This could be solved in a nicer matter and not create a pseudo difference
   * but for now we're importing the differences into Google Spreadsheets and
   * therefore we want a last row with it.
   */
  calculateTimes() {
    let totalReviewMeanTime = this.calculateTotalMeanTime('differenceReview');
    let totalCouncilMeanTime = this.calculateTotalMeanTime('differenceCouncil');

    // Yay, hacky for last rows
    this.differences.push({
      bugID: 'TOTAL MEAN TIME REVIEW',
      creationDate: totalReviewMeanTime
    }, {
      bugID: 'TOTAL MEAN TIME COUNCIL',
      creationDate: totalCouncilMeanTime
    });
  }

  /**
   * Processes all encountered errors and lists them on the console.
   */
  processEncounteredErrors() {
    if (this.processErrors.length === 0) {
      return;
    }

    console.log('----------------------');
    console.log('Errors we encountered:');

    _.each(this.processErrors, function (processError, callback) {
      console.log('Error with bug: ', processError.bugId);
      console.log(processError.error);
    });
  }

  /**
   * Processes a single bug to calculate everthing we need to know.
   *
   * @param {Object} bug to analyze
   * @param {Function} callback callback to be called once we're done so we can go ahead with async
   */
  processBugHistory(bug, callback) {
    console.log('Fetching history for ', bug.id);

    this.bugzilla.bugHistory(bug.id, (error, completeHistory) => {
      if (error) {
        // If we have an error from bugzilla, we do not want to reject
        // the promise, just write to the processErrors
        this.processErrors.push({
          error: error,
          bugId: bug.id
        });

        return callback();
      }

      let historiesForFlags = {
        'remo-review?': [],
        'remo-review+': [],
        'remo-review-': [],
        'remo-approval?': [],
        'remo-approval+': [],
        'remo-approval-': []
      };

      // Iterate through all change history entries. Every time somebody changes
      // something it will generate a new entry in the array.
      _.each(completeHistory[0].history, (history) => {
        // Iterate through every single change since it can involve multiple fields
        _.each(history.changes, (change) => {
          if (change.field_name !== 'flagtypes.name') {
            return;
          }

          // It is either just the flag, or the requestee in (...), we do not
          // care about that..
          var changedFlag = change.added.split('(')[0];
          if (historiesForFlags[changedFlag]) {
            historiesForFlags[changedFlag].push(history);
          }
        });
      });

      let difference = this.createDifference(bug, historiesForFlags, ['remo-review', 'remo-approval']);

      if (difference.hasDecision()) {
        console.log('difference', difference);
        this.differences.push(difference);
      }

      console.log('-----------');

      callback();
    });
  }

  /**
   * Creates a difference object according to the given type.
   *
   * @param  {Object} bug bug to take the difference from
   * @param  {Array} historyFlags  list of changes
   * @param  {Array} prefixes  list of flag prefixes we are calculating
   * @return {Difference} difference
   */
  createDifference(bug, historyFlags, prefixes) {
    let difference = new Difference(bug);

    _.each(prefixes, (prefix) => {
      let requests = historyFlags[prefix + '?'];
      let approved = historyFlags[prefix + '+'];
      let rejected = historyFlags[prefix + '-'];
      let lastRequest = requests[requests.length - 1];
      let lastApproval = approved[approved.length - 1];
      let lastRejection = rejected[rejected.length - 1];
      let lastDecision = lastApproval || lastRejection;

      let finalDecision = {
        change: lastDecision,
        decision: lastApproval ? 'approved' : 'rejected'
      };

      // We either want a request or a final decision, otherwise we will not
      // list it.
      if (_.isUndefined(lastRequest) || _.isUndefined(finalDecision.change)) {
        return;
      }

      let timeRequest = new Date(lastRequest.when);
      let timeDecision = new Date(finalDecision.change.when);
      let timeDifference = timeDecision - timeRequest;
      let duration = new Duration(timeRequest, timeDecision);

      if (prefix === 'remo-review') {
        difference.setProperties({
          reviewRequestDate: lastRequest.when,
          reviewDecisionDate: finalDecision.change.when,
          reviewDecision: finalDecision.decision,
          reviewer: finalDecision.change.who,
          differenceReview: timeDifference,
          differenceReviewFormatted: duration.toString(1)
        });
      } else if (prefix === 'remo-approval') {
        difference.setProperties({
          councilRequestDate: lastRequest.when,
          councilDecisionDate: finalDecision.change.when,
          councilDecision: finalDecision.decision,
          approver: finalDecision.change.who,
          differenceCouncil: timeDifference,
          differenceFormatted: duration.toString(1)
        });
      }
    });

    return difference;
  }

  /**
   * Calculates the mean time between request and approval
   *
   * @param {String} property  property to consider
   *
   * @return {Number} mean time it took to approve the request
   */
  calculateTotalMeanTime(property) {
    let totalTimeNeeded = 0;
    let totalBugs = this.differences.length;

    _.each(this.differences, (bugMeanTime) => {
      if (bugMeanTime[property]) {
        totalTimeNeeded = totalTimeNeeded + bugMeanTime[property];
      }
    });

    let meanTime = totalTimeNeeded / totalBugs;
    console.log('The total mean time (in ms) for ' + property + ' was', meanTime);

    return meanTime;
  }
}

module.exports = BugAnalyzer;
