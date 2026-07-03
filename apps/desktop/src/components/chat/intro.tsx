export type IntroProps = {
  personality?: string
  seed?: number
}

const HERO_IMAGE = `${import.meta.env.BASE_URL}lexedge-legal-counsel-hero.png`

export function Intro({ personality, seed }: IntroProps) {
  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-4 text-center sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      <img
        alt="LexEdge Personal AI Assistant. Your Legal Co-Counsel."
        className="h-auto max-h-[44vh] w-full max-w-[980px] object-contain opacity-95"
        draggable={false}
        src={HERO_IMAGE}
      />
    </div>
  )
}
