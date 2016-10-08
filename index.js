/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const _ = require('lodash');
const async = require('async');
const bz = require('bz');
const config = require('./config.js');
const Duration = require('duration');
const fs = require('fs-extra');

let allBugs = []
try {
  allBugs = require('./bugs.json');
} catch (ex) {
  console.log('existing bugs.json could not be found');
}

const bugzilla = bz.createClient({
  url: "https://bugzilla.mozilla.org/rest/",
  username: config.user,
  password: config.password,
  timeout: 30000
});

const params = {
  component: 'Budget Requests',
  product: 'Mozilla Reps',
  status: ['ASSIGNED', 'RESOLVED'],
  resolution: ['FIXED', 'INVALID', 'WONTFIX', '---']
};



/**
 * BugSearch is a wrapper for bugzilla interactions. This searches bugs.
 */
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


/**
 * BugAnalyzer analyzes the given bugs and prepares for output.
 */
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
        console.log('Fetching history for ', bug.id);

        this.bugzilla.bugHistory(bug.id, (error, completeHistory) => {
          if (error) return reject(error);

          let reviewRequests = [];
          let reviewApproved = [];
          let reviewRejected = [];
          let councilApprovalRequests = [];
          let councilApproved = [];
          let councilRejected = [];
          let changeHistories = completeHistory[0].history;

          // Iterate through all change history entries. Every time somebody changes
          // something it will generate a new entry in the array.
          _.each(changeHistories, (history) => {
            // Iterate through every single change since it can involve multiple fields
            _.each(history.changes, (change) => {
              if (change.field_name !== 'flagtypes.name') {
                return;
              }

              // TODO: we can do better than this!

              if (change.added.includes('remo-review?')) {
                reviewRequests.push(history);
              }

              if (change.added.includes('remo-review+')) {
                reviewApproved.push(history);
              }

              if (change.added.includes('remo-review-')) {
                reviewRejected.push(history);
              }

              if (change.added.includes('remo-approval?')) {
                councilApprovalRequests.push(history);
              }

              if (change.added.includes('remo-approval+')) {
                councilApproved.push(history);
              }

              if (change.added.includes('remo-approval-')) {
                councilRejected.push(history);
              }
            });
          });

          let requestDifferenceCouncil = {};
          let requestDifferenceReview = {};
          let difference = {};

          if (councilApprovalRequests.length > 0 && (councilApproved.length > 0 || councilRejected.length > 0)) {
            requestDifferenceCouncil = this.createDifference(bug, 'COUNCIL', councilApprovalRequests, councilApproved, councilRejected);
          }

          if (reviewRequests.length > 0 && (reviewApproved.length > 0 || reviewRejected.length > 0)) {
            requestDifferenceReview = this.createDifference(bug, 'REVIEW', reviewRequests, reviewApproved, reviewRejected);
          }

          _.merge(difference, requestDifferenceCouncil, requestDifferenceReview);

          if (!_.isEmpty(difference)) {
            console.log('difference', difference);
            this.differences.push(difference);
          }

          console.log('-----------');

          callback();
        });
      }, (err) => {
        if (err) return reject(err);

        console.log('Finished processing all requested bugs...');
        console.log('Number of added bugs:', this.differences.length);

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

        return resolve(this.differences)
      });
    });
  }

  /**
   * Creates a difference object according to the given type.
   *
   * @param  {Object} bug      bug to take the difference from
   * @param  {String} type     type of the difference, either COUNCIL or REVIEW
   * @param  {Array} requests  list of requests
   * @param  {Array} approved  list of approvals
   * @param  {Array} rejected  list of rejections
   * @return {Object}          difference object
   */
  createDifference(bug, type, requests, approved, rejected) {
    let lastRequest = requests[requests.length - 1];
    let lastApproval = approved[approved.length - 1];
    let lastRejection = rejected[rejected.length - 1];
    let lastDecision = lastApproval || lastRejection;

    let finalDecision = {
      change: lastDecision,
      decision: lastApproval ? 'approved' : 'rejected'
    };

    let timeRequest = new Date(lastRequest.when);
    let timeDecision = new Date(finalDecision.change.when);
    let timeDifference = timeDecision - timeRequest;
    let duration = new Duration(timeRequest, timeDecision);

    let difference = {
      bugID: bug.id,
      creationDate: bug.creation_time,
      status: bug.status,
      resolution: bug.resolution,
      bugSummary: bug.summary,
      whiteboard: bug.whiteboard,
      lastChangeDate: bug.last_change_time,
      approver: finalDecision.change.who,
      councilRequestDate: undefined,
      councilDecisionDate: undefined,
      councilDecision: undefined,
      differenceCouncil: undefined,
      differenceFormatted: undefined,
      reviewRequestDate: undefined,
      reviewDecisionDate: undefined,
      reviewDecision: undefined,
      differenceReview: undefined,
      differenceReviewFormatted: undefined
    };

    if (type === 'COUNCIL') {
      _.merge(difference, {
        councilRequestDate: lastRequest.when,
        councilDecisionDate: finalDecision.change.when,
        councilDecision: finalDecision.decision,
        differenceCouncil: timeDifference,
        differenceFormatted: duration.toString(1)
      });
    }

    if (type === 'REVIEW') {
      _.merge(difference, {
        reviewRequestDate: lastRequest.when,
        reviewDecisionDate: finalDecision.change.when,
        reviewDecision: finalDecision.decision,
        differenceReview: timeDifference,
        differenceReviewFormatted: duration.toString(1)
      });
    }

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
    console.log('The total mean time (in ms) was', meanTime);

    return meanTime;
  }
}

/**
 * JSONOutput
 */
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



const bugSearch = new BugSearch(allBugs, bugzilla);
const bugAnalyzer = new BugAnalyzer(bugzilla);

bugSearch.getAllBugs(params)
.then((bugs) => {
  return bugAnalyzer.processHistoryForAllBugs(bugs);
})
.then((differences) => {
  const output = new JSONOutput('alldifferences.json');
  return output.save();
})
.then(() => {
  console.log('Done!');
})
.catch((err) => {
  console.log(err);
});
