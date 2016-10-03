/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var _ = require('lodash');
var allBugs = require('./bugs.json');
var async = require('async');
var bz = require('bz');
var config = require('./config.js');
var Duration = require('duration');
var fs = require('fs-extra');

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

  async.eachSeries(bugs, function (bug, callback) {
    console.log('Fetching history for ', bug.id);

    bugzilla.bugHistory(bug.id, function (error, history) {
      if (error) return console.log(error);

      var approvalRequests = [];
      var approved = [];
      var histories = history[0].history;

      _.each(histories, function (historyObject) {
        _.each(historyObject.changes, function (change) {
          if (change.field_name === 'flagtypes.name' && change.added.includes('remo-approval?')) {
            console.log('Found a flag for approval?');

            var approvalRequestHistory = _.cloneDeep(historyObject);
            approvalRequests.push(approvalRequestHistory);
          }

          if (change.field_name === 'flagtypes.name' && change.added.includes('remo-approval+')) {
            console.log('Found a flag for approval+');

            var approvedHistory = _.cloneDeep(historyObject);
            approved.push(approvedHistory);
          }

          // We only want to process bugs which have a request and an approval
          if (approvalRequests.length > 0 && approved.length > 0) {
            var timeRequest = new Date(approvalRequests[approvalRequests.length - 1].when);
            console.log('timeRequest', timeRequest);

            var timeApproval = new Date(approved[approved.length - 1].when);
            console.log('timeApproval', timeApproval);

            var timeDifference = timeApproval - timeRequest;
            console.log('difference', timeDifference);

            var duration = new Duration(timeRequest, timeApproval);

            var requestDifference = {
              bugID: bug.id,
              status: bug.status,
              resolution: bug.resolution,
              bugSummary: bug.summary,
              dateRequest: approvalRequests[approvalRequests.length - 1].when,
              dateApproval: approved[approved.length - 1].when,
              difference: timeDifference,
              differenceFormatted: duration.toString(1),
              approver: approvalRequests[approvalRequests.length - 1].who
            };

            console.log('Found difference', requestDifference);

            allBugsMeanTimes.push(requestDifference);
          }
        });
      });

      console.log('-----------');

      callback();
    });
  }, function (err) {
    if (err) return console.log(err);

    console.log('Finished processing all requested bugs...');

    var totalMeanTime = calculateTotalMeanTime();

    // Yay, hacky for last row
    allBugsMeanTimes.push({
      bugID: 'TOTAL MEAN TIME',
      status: '',
      resolution: '',
      bugSummary: '',
      dateRequest: '',
      dateApproval: '',
      difference: '',
      differenceFormatted: '',
      approver: totalMeanTime
    });

    console.log('Writing all difference to alldifferences.json');

    fs.outputJson('alldifferences.json', allBugsMeanTimes, function (err) {
      if (err) console.log(err);

      console.log('Done!');
    });
  });
}

/**
 * Calculates the mean time between request and approval
 *
 * @return {Number} mean time it took to approve the request
 */
function calculateTotalMeanTime() {
  var totalTimeNeeded = 0;
  var totalBugs = allBugsMeanTimes.length;

  _.each(allBugsMeanTimes, function (bugMeanTime) {
    totalTimeNeeded = totalTimeNeeded + bugMeanTime.difference;
  });

  var meanTime = totalTimeNeeded / totalBugs;
  console.log('The total mean time (in ms) was', meanTime);

  return meanTime;
}
