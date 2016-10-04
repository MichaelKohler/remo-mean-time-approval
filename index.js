/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var _ = require('lodash');
var async = require('async');
var bz = require('bz');
var config = require('./config.js');
var Duration = require('duration');
var fs = require('fs-extra');

var allBugs = []
try {
  allBugs = require('./bugs.json');
} catch (ex) {
  console.log('existing bugs.json could not be found');
}

var bugzilla = bz.createClient({
  url: "https://bugzilla.mozilla.org/rest/",
  username: config.user,
  password: config.password,
  timeout: 30000
});

var allBugsMeanTimes = [];

var params = {
  component: 'Budget Requests',
  product: 'Mozilla Reps',
  status: ['ASSIGNED', 'RESOLVED'],
  resolution: ['FIXED', 'INVALID', 'WONTFIX', '---']
};

if (!allBugs || allBugs.length === 0) {
  console.log('Starting to fetch bugs...');

  bugzilla.searchBugs(params, function(error, bugs) {
    if (error) return console.log(error);

    fs.outputJson('bugs.json', bugs, function (err) {
      if (err) console.log(err);

      processHistoryForAllBugs(bugs);
    });
  });
} else {
  processHistoryForAllBugs(allBugs);
}

/**
 * Processes all given bugs to search for remo-approval? and remo-approval+
 *
 * @param  {Array} bugs all bugs that we fetched
 * @return void
 */
function processHistoryForAllBugs(bugs) {
  console.log('Number of bugs: ', bugs.length);

  // We need to use eachSeries, otherwise we are sending too many
  // requests to bugzilla at once
  async.eachSeries(bugs, function (bug, callback) {
    console.log('Fetching history for ', bug.id);

    bugzilla.bugHistory(bug.id, function (error, completeHistory) {
      if (error) return console.log(error);

      var reviewRequests = [];
      var reviewApproved = [];
      var reviewRejected = [];
      var councilApprovalRequests = [];
      var councilApproved = [];
      var councilRejected = [];
      var changeHistories = completeHistory[0].history;

      // Iterate through all change history entries. Every time somebody changes
      // something it will generate a new entry in the array.
      _.each(changeHistories, function (history) {
        // Iterate through every single change since it can involve multiple fields
        _.each(history.changes, function (change) {
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

      var requestDifferenceCouncil = {};
      var requestDifferenceReview = {};
      var difference = {};

      if (councilApprovalRequests.length > 0 && (councilApproved.length > 0 || councilRejected.length > 0)) {
        requestDifferenceCouncil = createDifference(bug, 'COUNCIL', councilApprovalRequests, councilApproved, councilRejected);
      }

      if (reviewRequests.length > 0 && (reviewApproved.length > 0 || reviewRejected.length > 0)) {
        requestDifferenceReview = createDifference(bug, 'REVIEW', reviewRequests, reviewApproved, reviewRejected);
      }

      _.merge(difference, requestDifferenceCouncil, requestDifferenceReview);

      if (!_.isEmpty(difference)) {
        console.log('difference', difference);
        allBugsMeanTimes.push(difference);
      }

      console.log('-----------');

      callback();
    });
  }, function (err) {
    if (err) return console.log(err);

    console.log('Finished processing all requested bugs...');
    console.log('Number of added bugs:', allBugsMeanTimes.length);

    var totalReviewMeanTime = calculateTotalMeanTime('differenceReview');
    var totalCouncilMeanTime = calculateTotalMeanTime('differenceCouncil');

    // Yay, hacky for last rows
    allBugsMeanTimes.push({
      bugID: 'TOTAL MEAN TIME REVIEW',
      creationDate: totalReviewMeanTime
    }, {
      bugID: 'TOTAL MEAN TIME COUNCIL',
      creationDate: totalCouncilMeanTime
    });

    console.log('Writing all difference to alldifferences.json');

    fs.outputJson('alldifferences.json', allBugsMeanTimes, function (err) {
      if (err) console.log(err);

      console.log('Done!');
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
function createDifference(bug, type, requests, approved, rejected) {
  var lastRequest = requests[requests.length - 1];
  var lastApproval = approved[approved.length - 1];
  var lastRejection = rejected[rejected.length - 1];
  var lastDecision = lastApproval || lastRejection;

  var finalDecision = {
    change: lastDecision,
    decision: lastApproval ? 'approved' : 'rejected'
  };

  var timeRequest = new Date(lastRequest.when);
  var timeDecision = new Date(finalDecision.change.when);
  var timeDifference = timeDecision - timeRequest;
  var duration = new Duration(timeRequest, timeDecision);

  var difference = {
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
function calculateTotalMeanTime(property) {
  var totalTimeNeeded = 0;
  var totalBugs = allBugsMeanTimes.length;

  _.each(allBugsMeanTimes, function (bugMeanTime) {
    if (bugMeanTime[property]) {
      totalTimeNeeded = totalTimeNeeded + bugMeanTime[property];
    }
  });

  var meanTime = totalTimeNeeded / totalBugs;
  console.log('The total mean time (in ms) was', meanTime);

  return meanTime;
}
