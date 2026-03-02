export type HelpTopic =
  | "add_store"
  | "switch_store"
  | "upload_shift_report"
  | "view_surveillance"
  | "upload_invoices"
  | "start_investigation";

type HelpEntry = {
  topic: HelpTopic;
  title: string;
  steps: string[];
};

const HELP: HelpEntry[] = [
  {
    topic: "add_store",
    title: "Add A Store",
    steps: [
      "Open Settings.",
      'Go to \"Stores\".',
      'Tap \"Add store\".',
      "Enter store name + store ID.",
      "Save.",
    ],
  },
  {
    topic: "switch_store",
    title: "Switch Stores",
    steps: ["Tap the store icon in the bottom bar (left).", "Pick the store you want."],
  },
  {
    topic: "upload_shift_report",
    title: "Upload A Shift Report",
    steps: [
      "Open Shift + Reports.",
      'Tap \"Start\".',
      "Scan receipt (sales) and review values.",
      "Upload cash count photo and enter cash amount.",
      'Tap \"Submit shift package\".',
    ],
  },
  {
    topic: "view_surveillance",
    title: "View Surveillance",
    steps: [
      "Open the Surveillance tab.",
      "Tap a report to view the summary and attachments.",
      "Use Search to filter by date, employee, or keywords.",
    ],
  },
  {
    topic: "upload_invoices",
    title: "Upload Invoices",
    steps: [
      "Open the Upload tab.",
      "Choose Invoice upload.",
      "Take photo(s) or upload files.",
      "Add due date + amount if prompted.",
      "Submit.",
    ],
  },
  {
    topic: "start_investigation",
    title: "Start An Investigation",
    steps: [
      "Open Shift + Reports.",
      "Open the shift you want to review.",
      'Tap \"Investigation\" and add notes.',
      "Save.",
    ],
  },
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\\s]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();

export function resolveHelpTopic(input: string): HelpEntry | null {
  const q = normalize(input);
  if (!q) return null;

  const match = (topic: HelpTopic, patterns: RegExp[]) =>
    patterns.some((re) => re.test(q)) ? HELP.find((h) => h.topic === topic)! : null;

  return (
    match("add_store", [/add store/, /new store/, /create store/]) ??
    match("switch_store", [/switch store/, /change store/, /other store/, /select store/]) ??
    match("upload_shift_report", [/upload shift/, /shift report/, /end of shift/, /submit shift/]) ??
    match("view_surveillance", [/surveillance/, /camera/, /footage/, /incident/]) ??
    match("upload_invoices", [/invoice/, /bill/, /due/, /payment/]) ??
    match("start_investigation", [/investigation/, /case/, /discipline/, /write up/]) ??
    null
  );
}

export function listHelpTopics(): Array<{ topic: HelpTopic; title: string }> {
  return HELP.map((entry) => ({ topic: entry.topic, title: entry.title }));
}

export function formatHelp(entry: HelpEntry) {
  return {
    topic: entry.topic,
    title: entry.title,
    steps: entry.steps,
  };
}

