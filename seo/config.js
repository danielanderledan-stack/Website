// Single source of truth for all SEO/brand data.
// This is vanilla HTML — import values from here manually into each page's <head>.
// Fields marked TODO: Dan require input before going live.

export const BRAND = {
  name: "Complete Digital",
  legalName: "Complete Digital",           // TODO: Dan — update if registered as Pty Ltd
  domain: "completedigital.com.au",
  url: "https://completedigital.com.au",
  logo: "https://completedigital.com.au/logo.png",
  description: "Melbourne web design agency building fast, conversion-focused websites for Australian businesses. Based in Bayside.",
  founder: "Daniel Anderle",
  foundingDate: "2025-03-28",
  address: {
    streetAddress: "",                      // TODO: Dan — add street address or leave blank for suburb-only
    addressLocality: "Black Rock",
    addressRegion: "VIC",
    postalCode: "3193",
    addressCountry: "AU"
  },
  geo: {
    latitude: -37.9736,
    longitude: 145.0203
  },
  telephone: "+61432839654",
  email: "daniel.anderle.dan@gmail.com",
  priceRange: "$$",
  sameAs: [
    // TODO: Dan — populate after socials are live:
    // "https://www.linkedin.com/company/complete-digital",
    // "https://www.instagram.com/completedigital",
    // "https://www.facebook.com/completedigital",
    // "https://www.google.com/maps/place/?cid=[GBP_CID]",
  ],
  areasServed: [
    "Melbourne", "Bayside", "Black Rock", "Brighton", "Sandringham",
    "Hampton", "Beaumaris", "Mentone", "Cheltenham", "Highett",
    "Elwood", "St Kilda", "South Yarra", "Richmond", "Hawthorn"
  ]
};

export const PRIMARY_KEYWORDS = {
  brand: "Complete Digital",
  brandLocal: "Complete Digital Melbourne",
  service: "web design Melbourne",
  localService: "web design Bayside"
};

// Per-page SEO metadata — update these when pages change or are added.
export const PAGES = {
  home: {
    path: "/",
    title: "Web Design Melbourne | Complete Digital",
    description: "Complete Digital builds fast, conversion-focused websites for Melbourne businesses. Based in Bayside. View our work or get a quote today.",
    canonical: "https://completedigital.com.au/"
  },
  design: {
    path: "/design.html",
    title: "Design Philosophy | Complete Digital Melbourne",
    description: "How Complete Digital builds tradie websites: listen first, mobile-first build, speed, conversion, then maintain. Five stages, no shortcuts.",
    canonical: "https://completedigital.com.au/design.html"
  },
  seo: {
    path: "/seo.html",
    title: "Our SEO Approach | Complete Digital Melbourne",
    description: "How Complete Digital gets tradies found on Google: keyword research, on-page, local SEO, content, authority building, and monitoring.",
    canonical: "https://completedigital.com.au/seo.html"
  },
  about: {
    path: "/about.html",
    title: "About Complete Digital | Melbourne Web Design Agency",
    description: "Meet Complete Digital — the Bayside Melbourne web design agency building fast, conversion-focused websites. Founder-led, results-driven.",
    canonical: "https://completedigital.com.au/about.html"
  },
  contact: {
    path: "/contact.html",
    title: "Contact Complete Digital | Melbourne Web Design",
    description: "Get in touch with Complete Digital. Free discovery call. Based in Bayside Melbourne, serving clients across Melbourne and Australia.",
    canonical: "https://completedigital.com.au/contact.html"
  }
};
