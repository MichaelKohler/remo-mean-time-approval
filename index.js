var bz = require('bz');
var _ = require('lodash');
var allBugs = require('./bugs.json');
var fs = require('fs-extra');
var async = require('async');
var config = require('./config.js');
var Duration = require('duration');

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

console.log(allBugs.length);

if (!allBugs || allBugs.length === 0) {
  console.log('starting to fetch bugs...');

  bugzilla.searchBugs(params, function(error, bugs) {
    if (error) {
      console.log(error);
    } else {
      fs.outputJson('bugs.json', bugs, function (err) {
        if (err) console.log(err);

        processHistoryForAllBugs(bugs);
      });
    }
  });
} else {
  processHistoryForAllBugs(allBugs);
}

function processHistoryForAllBugs(bugs) {
  console.log('Number of bugs: ', bugs.length);
  async.eachSeries(bugs, function (bug, callback) {
    console.log('fetching history for ', bug.id);

    bugzilla.bugHistory(bug.id, function (error, history) {
      if (error) console.log(error);

      var approvalRequests = [];
      var approved = [];
      var histories = history[0].history;

      _.each(histories, function (historyObject) {
        _.each(historyObject.changes, function (change) {
          if (change.field_name === 'flagtypes.name' && change.added.includes('remo-approval?')) {
            console.log('we have a flag for approval?');

            var approvalRequestHistory = _.cloneDeep(historyObject);
            approvalRequests.push(approvalRequestHistory);
          }

          if (change.field_name === 'flagtypes.name' && change.added.includes('remo-approval+')) {
            console.log('we have a flag for approval+');

            var approvedHistory = _.cloneDeep(historyObject);
            approved.push(approvedHistory);
          }

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

            allBugsMeanTimes.push(requestDifference);

            console.log('approvalRequests');
            console.log((require('util')).inspect(approvalRequests, showHidden=false, depth=10, colorize=true));
            console.log('approved');
            console.log((require('util')).inspect(approved, showHidden=false, depth=10, colorize=true));
          }
        });
      });

      callback();
    });
  }, function (err) {
    console.log('finished...');
    console.log((require('util')).inspect(allBugsMeanTimes, showHidden=false, depth=10, colorize=true));

    var totalTimeNeeded = 0;
    var totalBugs = allBugsMeanTimes.length;

    _.each(allBugsMeanTimes, function (bugMeanTime) {
      totalTimeNeeded = totalTimeNeeded + bugMeanTime.difference;
    });

    var meanTime = totalTimeNeeded / totalBugs;
    console.log(meanTime);

    // Yay, hacky for last row
    allBugsMeanTimes.push({
      bugID: 'Total mean time',
      approver: meanTime
    });

    fs.outputJson('alldifferences.json', allBugsMeanTimes, function (err) {
      if (err) console.log(err);

      console.log('Done!');
    });
  });
}
