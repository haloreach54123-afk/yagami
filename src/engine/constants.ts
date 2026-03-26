import type { CountryProfile, DeepEffort } from "../types/engine.js";

export const URL_REGEX = /https?:\/\/[^\s)\]]+/g;

export const DEEP_EFFORT_LEVELS: ReadonlySet<DeepEffort> = new Set(["fast", "balanced", "thorough"]);

export const CODE_PREFERRED_DOMAINS = [
  "github.com",
  "stackoverflow.com",
  "developer.mozilla.org",
  "docs.python.org",
  "npmjs.com",
] as const;

export const COMPANY_PREFERRED_DOMAINS = [
  "crunchbase.com",
  "pitchbook.com",
  "dnb.com",
  "dnb.co.uk",
  "opencorporates.com",
  "find-and-update.company-information.service.gov.uk",
  "endole.co.uk",
  "companycheck.co.uk",
  "northdata.com",
  "sec.gov",
  "linkedin.com",
  "abr.business.gov.au",
  "companies-register.companiesoffice.govt.nz",
  "core.cro.ie",
  "cro.ie",
  "ised-isde.canada.ca",
  "houjin-bangou.nta.go.jp",
  "sirene.fr",
  "kvk.nl",
  "bizfile.gov.sg",
  "handelsregister.de",
  "unternehmensregister.de",
] as const;

export const COMPANY_COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  uk: "uk",
  gb: "uk",
  "united-kingdom": "uk",
  "great-britain": "uk",

  us: "us",
  usa: "us",
  "united-states": "us",

  au: "au",
  australia: "au",

  nz: "nz",
  "new-zealand": "nz",

  ie: "ie",
  ireland: "ie",

  ca: "ca",
  canada: "ca",

  fr: "fr",
  france: "fr",

  de: "de",
  germany: "de",

  nl: "nl",
  netherlands: "nl",

  sg: "sg",
  singapore: "sg",

  jp: "jp",
  japan: "jp",
};

export const COMPANY_COUNTRY_PROFILES: Readonly<Record<string, CountryProfile>> = {
  uk: {
    label: "United Kingdom",
    domains: [
      "find-and-update.company-information.service.gov.uk",
      "opencorporates.com",
      "endole.co.uk",
      "companycheck.co.uk",
    ],
    seedUrls: (query: string) => [
      `https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(query)}`,
    ],
  },
  us: {
    label: "United States",
    domains: ["sec.gov", "opencorporates.com"],
    seedUrls: (query: string) => [`https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(query)}`],
  },
  au: {
    label: "Australia",
    domains: ["abr.business.gov.au", "abn.business.gov.au", "opencorporates.com"],
    seedUrls: (query: string) => [`https://abr.business.gov.au/Search/Index?SearchText=${encodeURIComponent(query)}`],
  },
  nz: {
    label: "New Zealand",
    domains: ["companies-register.companiesoffice.govt.nz", "opencorporates.com"],
    seedUrls: () => ["https://companies-register.companiesoffice.govt.nz/search/"],
  },
  ie: {
    label: "Ireland",
    domains: ["core.cro.ie", "cro.ie", "opencorporates.com"],
    seedUrls: () => ["https://core.cro.ie/"],
  },
  ca: {
    label: "Canada",
    domains: ["ised-isde.canada.ca", "opencorporates.com"],
    seedUrls: () => ["https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html"],
  },
  fr: {
    label: "France",
    domains: ["sirene.fr", "opencorporates.com"],
    seedUrls: (query: string) => [
      "https://www.sirene.fr/sirene/public/static/recherche?sirene_locale=en",
      `https://www.sirene.fr/sirene/public/recherche?nom=${encodeURIComponent(query)}`,
    ],
  },
  de: {
    label: "Germany",
    domains: ["handelsregister.de", "unternehmensregister.de", "northdata.com"],
    seedUrls: () => [
      "https://www.handelsregister.de/rp_web/normalesuche/welcome.xhtml",
      "https://www.unternehmensregister.de/en",
    ],
  },
  nl: {
    label: "Netherlands",
    domains: ["kvk.nl", "opencorporates.com"],
    seedUrls: () => ["https://www.kvk.nl/en/search/"],
  },
  sg: {
    label: "Singapore",
    domains: ["bizfile.gov.sg", "opencorporates.com"],
    seedUrls: () => ["https://www.bizfile.gov.sg/"],
  },
  jp: {
    label: "Japan",
    domains: ["houjin-bangou.nta.go.jp", "opencorporates.com"],
    seedUrls: () => ["https://www.houjin-bangou.nta.go.jp/en/index.html"],
  },
};
