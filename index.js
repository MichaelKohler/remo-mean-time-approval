/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


const bz = require('bz');
const config = require('./config.js');

const BugSearch = require('./lib/BugSearch');
const BugAnalyzer = require('./lib/BugAnalyzer');
const JSONOutput = require('./lib/JSONOutput');

let allBugs = []
try {
  allBugs = require('./bugs.json');
} catch (ex) {
  console.log('existing bugs.json could not be found');
}

const bugzillaAPIOptions = {
  url: "https://bugzilla.mozilla.org/rest/",
  timeout: 30000
};

if (config.apiKey) {
  bugzillaAPIOptions.api_key = config.apiKey;
} else {
  bugzillaAPIOptions.username = config.user;
  bugzillaAPIOptions.password = config.password;
}

const bugzilla = bz.createClient(bugzillaAPIOptions);

const params = {
  component: 'Budget Requests',
  product: 'Mozilla Reps',
  status: ['ASSIGNED', 'RESOLVED'],
  resolution: ['FIXED', 'INVALID', 'WONTFIX', '---']
};

const bugSearch = new BugSearch(allBugs, bugzilla);
const bugAnalyzer = new BugAnalyzer(bugzilla);

bugSearch.getAllBugs(params)
.then((bugs) => {
  return bugAnalyzer.processHistoryForAllBugs(bugs);
})
.then((differences) => {
  const output = new JSONOutput('alldifferences.json');
  return output.save(differences);
})
.then(() => {
  console.log('Done!');
})
.catch((err) => {
  console.log(err);
});
