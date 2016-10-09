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
}

module.exports = Difference;
