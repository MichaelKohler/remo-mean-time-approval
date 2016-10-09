class Difference {
  /**
   * Creates a difference from the given bug information
   *
   * @param {Object} bug bug to take info from
   */
  constructor(bug) {
    this.bugID = bug.id;
    this.creationDate = bug.creation_time;
    this.status = bug.status;
    this.resolution = bug.resolution;
    this.bugSummary = bug.summary;
    this.whiteboard = bug.whiteboard;
    this.lastChangeDate = bug.last_change_time;
  }

  /*
   * Merges the given properties to this class instance
   */
  setProperties(properties) {
    Object.assign(this, properties);
  }

  /**
   * Whether or not this difference has a decision
   *
   * @return {boolean}
   */
  hasDecision() {
    return this.differenceCouncil || this.differenceReview;
  }

  /**
   * Analyzes the whitebord to determine the necessary approver
   */
  setApproverBody(whiteboardChanges) {
    let approvers = {
      'Council Reviewer Assigned': 'single-coucil',
      'Review Team member Assigned': 'single-review-team',
      'Council approval needed': 'council',
      'Review Team approval needed': 'review-team'
    };

    let approverBody = '';

    // TODO: iterate over whiteboardChanges and do this here..
    for (let key of Object.keys(approvers)) {
      if (this.whiteboard.includes(key)) {
        approverBody = approvers[key];
      }
    }

    this.approverBody = approverBody;
  }
}

module.exports = Difference;
