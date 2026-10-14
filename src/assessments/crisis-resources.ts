/**
 * Location-aware crisis support resources.
 * Do not invent hotlines. Label coverage clearly.
 */

export type CrisisResource = {
  id: string;
  name: string;
  description: string;
  contact: string;
  href?: string;
  region: string;
  coverageNote: string;
};

export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    id: "us-988",
    name: "988 Suicide & Crisis Lifeline",
    description: "Free, confidential support for people in distress in the United States.",
    contact: "Call or text 988",
    href: "https://988lifeline.org/",
    region: "US",
    coverageNote: "United States resource",
  },
  {
    id: "intl-iasp",
    name: "International Association for Suicide Prevention",
    description: "Find local crisis resources in many countries.",
    contact: "Browse local resources",
    href: "https://www.iasp.info/suicidalthoughts/",
    region: "International",
    coverageNote: "Directory of local resources worldwide",
  },
  {
    id: "local-emergency",
    name: "Local emergency services",
    description:
      "If you are in immediate danger, contact your local emergency number or go to the nearest emergency department.",
    contact: "Local emergency number",
    region: "All",
    coverageNote: "Always available where emergency services exist",
  },
];

export function getCrisisSupportPayload() {
  return {
    title: "Need support now?",
    message:
      "If you are in crisis or feel unsafe, reach out to local emergency services or a trusted healthcare professional. Online assessments are not a crisis service and cannot predict safety.",
    resources: CRISIS_RESOURCES,
  };
}
