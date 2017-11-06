remo-mean-time-approval
====

This script crawles all Mozilla Reps Buget requests to calculate the average time it took from requesting an approval (remo-approval?) to the actual approval of the budget request (remo-approval+) as well as the time it took for initial remo-review.

It will generate an object for every bug that fulfills the criteria and calculate its time-to-review and time-to-approval time.

Output-Example
----

```
{
  bugID: 111111,
  creationDate: '2012-09-08T00:51:40Z',
  status: 'RESOLVED',
  resolution: 'FIXED',
  bugSummary: 'Budget Request - John Doe - https://reps.mozilla.org/u/JOHNDOE/',
  whiteboard: 'Payment processed',
  lastChangeTime: '2013-10-14T20:43:20Z',
  councilRequestDate: '2012-10-03T10:11:03Z',
  councilDecisionDate: '2012-10-10T12:22:41Z',
  councilDecision: 'approved',
  approver: 'approver@example.org',
  approverBody: 'single-council',
  differenceCouncil: 612698000,
  differenceFormatted: '7d 2h 11m 38s 0ms',
  reviewRequestDate: '2012-10-05T13:45:14Z',
  reviewDecisionDate: '2012-10-08T18:09:51Z',
  reviewDecision: 'approved',
  reviewer: 'reviewer@example.org'
  differenceReview: 275077000,
  differenceReviewFormatted: '3d 4h 24m 37s 0ms'
}
```

Criteria
----

For a bug to be considered it needs to fulfill the following criteria:

* Status needs to be either 'ASSIGNED' or 'RESOLVED'
* Resolution needs to be '---', 'FIXED', 'INVALID' or 'WONTFIX'
* Bug needs to be in the 'Budget Requests' component of the 'Mozilla Reps' product
* There needs to be a request for remo-review? or remo-approval?
* There needs to be an review or approval (remo-review+ or remo-approval+)

Currently the script does not take any whiteboard tags into account such as [approved] but no flags set.

How to run this script
-----

Make sure you have installed [Node.js](http://nodejs.org/)

Add your bugzilla credentials in `config.js`. This can also be a Bugzilla API key (necessary if the user account is secured by 2FA authentication!). Please keep in mind that these will be seen by anyone looking at your screen while typing them in!

With user and password:

```
module.exports = {
  user: '<yourUserID>',
  password: '<yourPassword>'
};
```

With API key:

```
module.exports = {
  apiKey: '<yourAPIKey>
};
```

After this you can install the necessary dependencies and start the script:

```
$ npm install
$ node index.js
```
