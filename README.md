# SwingFlow

Your personal West Coast Swing companion. Browse 60+ patterns, track technique with checklists, retain everything with spaced repetition, and train your rhythm — built for dancers who practice.

## Features

### Pattern Library
Browse 60+ West Coast Swing patterns organized by difficulty (beginner, intermediate, advanced) and category (basics, push/pull, turns, whips, wraps, slides). Each pattern includes step-by-step mechanics, common mistakes, and technique checklists.

### Spaced Repetition
Add patterns to your review deck and retain them using the SM-2 algorithm. Rate your recall after each flashcard review and SwingFlow automatically schedules the next review at the optimal time.

### Technique Checklists
16 checkpoints per pattern covering connection, frame, posture, timing, and musicality/styling. Track your progress across every pattern you're learning.

### Practice Timer
Guided warm-up routines in 5, 15, or 30-minute sessions. Covers joint mobility, body isolation, walking practice, triple step drills, anchor variations, and pattern work.

### Rhythm Trainer
Web Audio-powered metronome with adjustable BPM (60-140), straight and swung feel modes, and multiple practice modes:
- **Listen** - Count along to the metronome
- **Tap** - Click along to the beat
- **Challenge** - Target specific subdivisions (walks, triples, anchors)

Includes WCS pattern presets, tempo ramp for progressive difficulty, timing accuracy visualization, and accuracy heatmaps.

### Anchor Variations
Dedicated section covering standard, sailing, stutter, body roll, and musical anchor styles with execution tips and musicality notes.

## Getting Started

### Prerequisites

- Node.js 18+

### Installation

```bash
git clone https://github.com/sauravpanda/swingflow.git
cd swingflow
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build

```bash
npm run build
```

## Tech Stack

- **Next.js 16** with App Router
- **React 19** + **TypeScript**
- **Tailwind CSS 4** for styling
- **shadcn/ui** + **Radix UI** for accessible components
- **Web Audio API** for the metronome and rhythm trainer
- **localStorage** for client-side data persistence (no account needed)

## How It Works

SwingFlow runs entirely in the browser. All your progress, review history, and practice sessions are saved to localStorage on your device. No backend, no account required — just open and practice.

## Project Structure

```
src/
├── app/              # Next.js App Router pages
│   ├── (app)/        # Main app routes (dashboard, patterns, review, etc.)
│   └── page.tsx      # Landing page
├── components/       # React components
│   ├── ui/           # shadcn/ui primitives
│   └── rhythm/       # Rhythm trainer components
├── hooks/            # Custom hooks (metronome, tap tracker, timer, etc.)
├── lib/              # Utilities (store, SM-2 algorithm, routines)
└── data/             # Pattern and anchor JSON datasets
```

## Deployment

SwingFlow is configured for static export and deploys to Cloudflare Pages via `wrangler.toml`.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## Author

Created by [Saurav Panda](https://github.com/sauravpanda)

## License

MIT License. See [LICENSE](LICENSE) for details.
