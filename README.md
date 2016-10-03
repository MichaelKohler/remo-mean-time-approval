remo-mean-time-approval
====

This script crawles all Mozilla Reps Buget requests to calculate the average time it took from requesting an approval (remo-approval?) to the actual approval of the budget request (remo-approval+).

It will generate an object for every bug that fulfills the criteria and calculate its time-to-approval time. Further it will calculate the average time going through all those bugs.

Output-Example
----

```
{
  bugID: 111111,
  status: 'ASSIGNED',
  resolution: '',
  bugSummary: 'Budget Request - John Doe - https://reps.mozilla.org/u/JOHNDOE/',
  dateApprovalRequest: '2013-10-14T11:49:08Z',
  dateApproval: '2013-10-14T19:13:39Z',
  difference: 26671000,
  differenceFormatted: '7h 24m 31s 0ms',
  approver: 'some-reps-reviewer@example.org'
}
```

Criteria
----

For a bug to be considered it needs to fulfill the following criteria:

* Status needs to be either 'ASSIGNED' or 'FIXED'
* Resolution needs to be '---', 'RESOLVED', 'INVALID' or 'WONTFIX'
* Bug needs to be in the 'Budget Requests' component of the 'Mozilla Reps' product
* There needs to be a request for remo-approval? at some point
* There needs to be an approval (remo-approval+)

Currently the script does not take any whiteboard tags into account such as [approved] but no flags set.

How to run this script
-----

Make sure you have installed [Node.js](http://nodejs.org/)

Add your bugzilla credentials in `config.js`. Please keep in mind that these will be seen by anyone looking at your screen while typing them in!

```
module.exports = {
  user: '<youruserid>',
  password: '<yourpassword>'
};
```

After this you can install the necessary dependencies and start the script:

```
$ npm install
$ node index.js
```
