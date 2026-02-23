export type RoutineStep = {
  label: string;
  duration: number; // seconds
  description: string;
};

export type Routine = {
  id: string;
  name: string;
  duration: number; // total seconds
  steps: RoutineStep[];
};

export const routines: Routine[] = [
  {
    id: "warmup-5",
    name: "Quick Warm-Up",
    duration: 5 * 60,
    steps: [
      {
        label: "Body Isolation",
        duration: 60,
        description: "Chest, rib cage, and hip isolations. Loosen up the torso.",
      },
      {
        label: "Walking Practice",
        duration: 60,
        description: "Walk in the slot with smooth heel-to-toe transitions.",
      },
      {
        label: "Triple Step Drill",
        duration: 60,
        description: "Practice triple steps in place. Focus on even timing.",
      },
      {
        label: "Anchor Practice",
        duration: 60,
        description: "Standard anchor step with imaginary partner connection.",
      },
      {
        label: "Sugar Push Solo",
        duration: 60,
        description: "Walk through sugar push footwork by yourself.",
      },
    ],
  },
  {
    id: "warmup-15",
    name: "Standard Warm-Up",
    duration: 15 * 60,
    steps: [
      {
        label: "Joint Mobility",
        duration: 90,
        description: "Circles: ankles, knees, hips, shoulders, wrists.",
      },
      {
        label: "Body Isolation",
        duration: 90,
        description: "Chest, rib cage, and hip isolations in all directions.",
      },
      {
        label: "Walking Practice",
        duration: 120,
        description: "Walk in slot. Focus on smooth weight transfer and heel leads.",
      },
      {
        label: "Triple Step Drill",
        duration: 90,
        description: "Triple steps forward, back, and in place. Keep them even.",
      },
      {
        label: "Anchor Variations",
        duration: 120,
        description: "Practice standard, sailing, and stutter anchors.",
      },
      {
        label: "Sugar Push",
        duration: 90,
        description: "Full sugar push with visualization of partner connection.",
      },
      {
        label: "Side Pass",
        duration: 90,
        description: "Left and right side passes. Focus on clearing the slot.",
      },
      {
        label: "Musicality Movement",
        duration: 120,
        description: "Put on music and move freely. Practice hearing the beats.",
      },
    ],
  },
  {
    id: "warmup-30",
    name: "Full Practice",
    duration: 30 * 60,
    steps: [
      {
        label: "Joint Mobility",
        duration: 120,
        description: "Full body joint circles. Get everything moving.",
      },
      {
        label: "Body Isolation",
        duration: 120,
        description: "Chest, rib cage, hip isolations. Add body rolls.",
      },
      {
        label: "Walks & Weight Transfer",
        duration: 150,
        description: "Walk the slot with focus on smooth, grounded movement.",
      },
      {
        label: "Triple Step Drill",
        duration: 120,
        description: "Triple steps in all directions. Focus on even timing and floor contact.",
      },
      {
        label: "Anchor Deep Dive",
        duration: 150,
        description: "Practice all anchor types: standard, sailing, stutter, syncopated.",
      },
      {
        label: "Sugar Push & Variations",
        duration: 150,
        description: "Sugar push, sugar tuck, push break. Feel the compression.",
      },
      {
        label: "Side Pass & Turns",
        duration: 180,
        description: "Side passes with turns. Practice clean entry and exit.",
      },
      {
        label: "Whip Footwork",
        duration: 180,
        description: "8-count whip footwork. Focus on the redirection.",
      },
      {
        label: "Free Dance",
        duration: 180,
        description: "Put on music. String patterns together. Dance!",
      },
      {
        label: "Cool Down",
        duration: 150,
        description: "Gentle stretching. Calves, hamstrings, hip flexors, shoulders.",
      },
    ],
  },
];
