# analyzer spec delta

## ADDED Requirements

### Requirement: StructuralLandmarkSignals

The analyzer SHALL label each function with the set of structural-interest **signals** it earns —
drawn from `hub`, `orchestrator`, `chokepoint`, `volatile`, `entrypoint`, `dead`. Each signal SHALL
be produced by an existing deterministic classifier (the same thresholds already behind
`get_critical_hubs`, `get_god_functions`, leaf/dead-code analysis, and change-coupling), and SHALL
carry the raw evidence that earned it. The analyzer SHALL NOT blend signals into a composite salience
score and SHALL NOT introduce any new threshold or weighting constant; ranking is the caller's
responsibility.

#### Scenario: Each landmark carries its earned labels with evidence, and no score

- **GIVEN** a call graph containing a high fan-in hub, a high fan-out orchestrator, and a volatile
  (high-churn) function
- **WHEN** landmark signals are computed
- **THEN** the hub entry carries a `hub` label with its real `fanIn`, the orchestrator carries an
  `orchestrator` label with its real `fanOut`, and the volatile function carries a `volatile` label
  with its churn evidence
- **AND** no entry carries a composite `score` or rank field — only labels and evidence

#### Scenario: Chokepoint is a parameter-free composition, not a new cutoff

- **GIVEN** a function that is in the hub set but not in the god-function set
- **WHEN** landmark signals are computed
- **THEN** it carries the `chokepoint` label, derived solely from the conjunction `hub ∧ ¬orchestrator`
- **AND** the computation introduces no numeric threshold that is not already defined by the hub and
  god-function classifiers

### Requirement: OrientSurfacesTaskScopedLandmarks

The `orient` response SHALL include a bounded `landmarks` list: the labeled functions nearest to the
functions matched for the task, **ordered by structural proximity only** (call-distance or hop
count), each entry carrying its signal labels and evidence. The list SHALL be present in full mode and
omitted when `lean` is requested. The ordering SHALL NOT use a blended salience score.

#### Scenario: Lean orient omits landmarks

- **GIVEN** an `orient` call with `lean = true`
- **WHEN** the response is produced
- **THEN** it contains no `landmarks` section, preserving the lean path's cost

#### Scenario: Full orient surfaces nearby anchors with labels, ordered by proximity

- **GIVEN** an `orient` call for a task that matches a set of functions
- **WHEN** the full response is produced
- **THEN** `landmarks` lists the labeled functions nearest those matches, ordered by structural
  proximity, each entry carrying its `signals` (e.g. `hub`, `volatile`) and the evidence behind them
