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
        this.processBugHistory(bug, callback);
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
        console.log(error);

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

      let whiteboardChanges = [];

      // Iterate through all change history entries. Every time somebody changes
      // something it will generate a new entry in the array.
      _.each(completeHistory[0].history, (history) => {
        // Iterate through every single change since it can involve multiple fields
        _.each(history.changes, (change) => {
          if (change.field_name === 'whiteboard') {
            whiteboardChanges.push(change);
            return;
          }

          if (change.field_name === 'flagtypes.name') {
            // There can be multiple flags being changed in one change
            var changedFlags = change.added.split(',');
            _.each(changedFlags, function (changedFlag) {
              changedFlags = changedFlag.trim();

              // It is either just the flag, or the requestee in (...), we do not
              // care about that..
              changedFlag = changedFlags.split('(')[0];

              if (historiesForFlags[changedFlag]) {
                historiesForFlags[changedFlag].push(history);
              }
            });
          }
        });
      });

      let difference = this.createDifference(bug, historiesForFlags, ['remo-review', 'remo-approval']);
      difference.setApproverBody(this.analyzeApproverBody(whiteboardChanges));

      if (difference.hasDecision()) {
        console.log('difference', difference);
        this.differences.push(difference);
      }

      console.log('-----------');

      callback();
    });
  }

  /**
   * Analyzes the whiteboard changes to find a matching change to indicate
   * who was responsible for the approval. This does not catch all cases since
   * these whiteboard tags had different names and were not always used. But
   * unfortunately this is our best guess since we can't get the amount of
   * the budget directly..
   *
   * @param {Array} whiteboardChanges changes that happened in the whiteboard
   *
   * @return {String} key to indicate the approver
   */
  analyzeApproverBody(whiteboardChanges) {
    let approvers = {
      'Council Reviewer Assigned': 'single-coucil',
      'Review Team member Assigned': 'single-review-team',
      'Council approval needed': 'council',
      'Review Team approval needed': 'review-team'
    };

    let approverBody = '';

    _.each(whiteboardChanges, (whiteboardChange) => {
      for (let key of Object.keys(approvers)) {
        if (whiteboardChange.added.includes(key)) {
          approverBody = approvers[key];
        }
      }
    });

    return approverBody;
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

      /*
       * We do not want to take an approval or rejection that was before another
       * request. This happened in a few requests where somebody set the flag back
       * to remo-approval? after the approval or rejection was given..
       * Is it safe to assume that the second last request was the matching one
       * to not further complicate this requirement? Of course it would be better
       * to do this bullet proof but I can't do it right now due to time constraints :(
       *
       * For now we can also assume that there was a request for the decision...
       *
       * See https://github.com/MichaelKohler/remo-mean-time-approval/issues/1
       *
       * TODO: make this more bullet proof to make sure that we have the right combination
       * since it can still happen that the request we pick is after the rejection
       * or approval.
       *
       */
      if (!_.isUndefined(lastRequest) && !_.isUndefined(lastRequest.when) && !_.isUndefined(lastDecision)
          && !_.isUndefined(lastDecision.when)) {
        if (new Date(lastRequest.when) > new Date(lastDecision.when)) {
            lastRequest = requests[requests.length - 2];
        }
      }

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
    let totalBugs = 0;

    _.each(this.differences, (bugMeanTime) => {
      if (bugMeanTime[property]) {
        totalBugs++;
        totalTimeNeeded = totalTimeNeeded + bugMeanTime[property];
      }
    });

    let meanTime = totalTimeNeeded / totalBugs;
    console.log('The total mean time (in ms) for ' + property + ' was', meanTime);

    return meanTime;
  }
}

module.exports = BugAnalyzer;
