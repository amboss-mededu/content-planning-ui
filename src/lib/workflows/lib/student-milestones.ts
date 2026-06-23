/**
 * Built-in medical-student milestone set for `curriculum-mapping` specialties.
 *
 * Unlike the clinician ACGME milestones (competency × Level 1–5) or a list of
 * activities, these are **score-level criteria**: a generic, year-based rubric
 * the mapping agent grades coverage against on the student scale
 * (0 none → 1 Year 1 → … → 4 Year 4 → 5 residency-ready). Each level describes
 * the depth of coverage a topic needs to be adequate for a student at that
 * point in training; the curriculum mapping prompt scores 0–5 against it.
 *
 * Seeded onto `specialties.milestones` when a curriculum specialty is created,
 * offered as a "Load default" reset, and overridable by upload/extraction.
 *
 * Stored as a JSON string in the nested shape the milestone tree renderer
 * (`milestones-view.tsx`) walks: a top-level set key → level → criteria.
 */

const CURRICULUM_MILESTONES = {
  Curriculum_Coverage_Levels: {
    Year_1: [
      'Normal structure and function relevant to the topic: anatomy, histology, physiology, and biochemistry',
      'Core definitions, terminology, and basic epidemiology',
      'Foundational mechanisms underlying the topic (pre-clerkship foundational sciences)',
    ],
    Year_2: [
      'Pathophysiology and mechanisms of disease for the topic',
      'Relevant pharmacology and the principles of diagnosis',
      'Integration of basic and clinical sciences at USMLE Step 1 depth',
    ],
    Year_3: [
      'Typical clinical presentation, differential diagnosis, and evidence-based diagnostic workup',
      'First-line management of common presentations encountered on core clerkships',
      'Application of knowledge to patient care at USMLE Step 2 CK depth',
    ],
    Year_4: [
      'Management of complex, atypical, or less common presentations',
      'Independent prioritization and initial decision-making approaching residency readiness',
      'Acting-/sub-internship depth, including care transitions and escalation',
    ],
    Residency_Ready: [
      'Comprehensive depth meeting all graduation competencies for the topic',
      'Prepared to manage the topic under indirect supervision on day one of residency',
    ],
  },
} as const;

/** The default curriculum coverage-level rubric, ready to store on
 *  `specialties.milestones` (pretty-printed JSON string). */
export const DEFAULT_CURRICULUM_MILESTONES: string = JSON.stringify(
  CURRICULUM_MILESTONES,
  null,
  2,
);
