import { Link } from "../router.tsx";

interface UrlExample {
  url: string;
  description: string;
}

interface SourceGuide {
  name: string;
  examples: UrlExample[];
}

const SOURCES: SourceGuide[] = [
  {
    name: "Biddr",
    examples: [
      { url: "https://www.biddr.com/<house>/auction?a=<auction_id>", description: "Saves an entire auction." },
      {
        url: "https://www.biddr.com/search?s=<term>&c=&pf=&pt=&pc=<currency>",
        description: "Saves every lot matching a search across Biddr's own auctions.",
      },
      { url: "https://www.biddr.com/<house>/auction?a=<auction_id>&l=<lot_id>", description: "Saves a single lot." },
    ],
  },
  {
    name: "sixbid.com",
    examples: [
      { url: "https://www.sixbid.com/en/<house>/<auction_id>", description: "Saves an entire auction." },
      {
        url: "https://www.sixbid.com/en/<house>/<auction_id>/<category>/<lot_id>/<slug>",
        description: "Saves a single lot.",
      },
      {
        url: "https://www.sixbid.com/en/lots/page/1/perPage/100?term=<term>&currency=<currency>",
        description: "Saves every lot matching a search across every company's auctions on sixbid.",
      },
    ],
  },
  {
    name: "jesusvico.com",
    examples: [
      {
        url: "https://www.jesusvico.com/en/subasta/<auction-slug>_I<auction_id>-001",
        description: "Saves an entire auction.",
      },
      {
        url: "https://www.jesusvico.com/en/lot/I<auction_id>-<x>-<x>/<lot_id>-<y>-<slug>",
        description: "Saves a single lot.",
      },
      {
        url: "https://www.jesusvico.com/en/subasta/<auction-slug>_I<auction_id>-001?description=<term>",
        description: "Saves only the lots matching a filter/search within that auction.",
      },
    ],
  },
  {
    name: "numisbids.com",
    examples: [
      { url: "https://www.numisbids.com/sale/<sale_id>", description: "Saves an entire auction." },
      {
        url: "https://www.numisbids.com/searchall?searchall=<term>",
        description: "Saves every lot matching a search across every auction on the site.",
      },
      { url: "https://www.numisbids.com/sale/<sale_id>/lot/<lot_number>", description: "Saves a single lot." },
    ],
  },
  {
    name: "aureo.com",
    examples: [
      { url: "https://www.aureo.com/en/subasta/<auction_id>", description: "Saves an entire auction." },
      {
        url: "https://www.aureo.com/en/precios/<brand>/<year>",
        description: "Saves every auction a brand ran in a given year. Can be slow - it fetches everything, not a filtered subset.",
      },
    ],
  },
];

export function GuidePage({ navigate }: { navigate: (path: string) => void }) {
  return (
    <div className="page page-narrow">
      <div className="guide-header">
        <Link to="/" navigate={navigate} className="guide-back">
          ← Back
        </Link>
        <h1>Supported URLs</h1>
        <p>Paste any of these into the retrieve box on the home page.</p>
      </div>

      {SOURCES.map((source) => (
        <div className="guide-source" key={source.name}>
          <h2>{source.name}</h2>
          <dl className="guide-url-list">
            {source.examples.map((example) => (
              <div className="guide-url-entry" key={example.url}>
                <dt>
                  <code>{example.url}</code>
                </dt>
                <dd>{example.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
