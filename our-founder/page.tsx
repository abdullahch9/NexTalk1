import type { Metadata } from "next";
import AboutBio from "@/components/AboutOurFounderpage/components/AboutBio";
import AnswerSummary from "@/components/AboutOurFounderpage/components/AnswerSummary";
import Breadcrumb from "@/components/AboutOurFounderpage/components/Breadcrumb";
import Faq from "@/components/AboutOurFounderpage/components/FAQ";
import FounderCTA from "@/components/AboutOurFounderpage/components/FounderCTA";
import FounderExperience from "@/components/AboutOurFounderpage/components/FounderExperience";
import FounderHero from "@/components/AboutOurFounderpage/components/FounderHero";
import JourneyTimeline from "@/components/AboutOurFounderpage/components/JourneyTimeline";
import LocationsMap from "@/components/AboutOurFounderpage/components/LocationsMap";
import StatsCards from "@/components/AboutOurFounderpage/components/StatsCards";
import {
  FOUNDER,
  SITE,
  // Renamed: importing `URL` directly shadows the global URL class.
  URL as PAGE_URL,
  UPDATED,
} from "@/components/AboutOurFounderpage/data";
import { buildPageMetadata, jsonLd } from "@/lib/seo";

/* -------------------------------------------------------------------------- */
/*  Single source of truth for values that were repeated                      */
/* -------------------------------------------------------------------------- */

const [firstName, ...restName] = FOUNDER.name.split(" ");
const lastName = restName.join(" ");

const title = `${FOUNDER.name} – Founder & CEO`;

const description = `Meet ${FOUNDER.name}, Founder and CEO of ${FOUNDER.company}. Learn about his journey, leadership, software engineering background, and work building AI, SaaS, cloud, web, and mobile solutions.`;

const keywords = [
  FOUNDER.name,
  `${FOUNDER.name} ${FOUNDER.company}`,
  `${FOUNDER.company} founder`,
  `${FOUNDER.company} CEO`,
  `${FOUNDER.company} leadership`,
  "software company founder Pakistan",
  "software entrepreneur Lahore",
  "AI company founder Pakistan",
  "SaaS founder Pakistan",
];

const photoAlt = `${FOUNDER.name}, Founder and CEO of ${FOUNDER.company}`;

// Used by the JSON-LD below. Keep in sync with the <Breadcrumb /> component,
// or better, export this list from data.ts and use it in both places.
const breadcrumbs = [
  { name: "Home", item: SITE },
  { name: "About", item: `${SITE}/about` },
  { name: "Our Founder", item: PAGE_URL },
];

/* -------------------------------------------------------------------------- */
/*  Metadata                                                                  */
/* -------------------------------------------------------------------------- */

export const metadata: Metadata = {
  ...buildPageMetadata({
    title,
    description,
    path: PAGE_URL.replace(SITE, ""),
    keywords,
    ogImage: FOUNDER.photo,
  }),
  authors: [{ name: FOUNDER.name, url: PAGE_URL }],
  openGraph: {
    type: "profile",
    url: PAGE_URL,
    title,
    description,
    siteName: FOUNDER.company,
    locale: "en_US",
    firstName,
    lastName,
    images: [{ url: FOUNDER.photo, width: 1200, height: 630, alt: photoAlt }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [FOUNDER.photo],
  },
};

/* -------------------------------------------------------------------------- */
/*  Structured data                                                           */
/* -------------------------------------------------------------------------- */

const personId = `${SITE}/#hassan-abbas`;

const founderJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "ProfilePage",
      "@id": `${PAGE_URL}#webpage`,
      url: PAGE_URL,
      name: `${FOUNDER.name} – Founder & CEO of ${FOUNDER.company}`,
      description,
      inLanguage: "en",
      dateModified: UPDATED,
      isPartOf: { "@id": `${SITE}/#website` },
      about: { "@id": personId },
      mainEntity: { "@id": personId },
      breadcrumb: { "@id": `${PAGE_URL}#breadcrumb` },
    },
    {
      "@type": "Person",
      "@id": personId,
      name: FOUNDER.name,
      givenName: firstName,
      familyName: lastName,
      jobTitle: FOUNDER.role,
      description: FOUNDER.answer,
      image: { "@type": "ImageObject", url: FOUNDER.photo },
      url: PAGE_URL,
      worksFor: { "@id": `${SITE}/#organization` },
      sameAs: FOUNDER.socials
        .map((social) => social.href)
        .filter((href) => href.startsWith("http")),
      knowsAbout: [
        "Artificial intelligence",
        "Software engineering",
        "SaaS development",
        "Cloud infrastructure",
        "Web development",
        "Mobile application development",
        "Custom software development",
        "Business automation",
      ],
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${PAGE_URL}#breadcrumb`,
      itemListElement: breadcrumbs.map(({ name, item }, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name,
        item,
      })),
    },
  ],
};

export default function OurFounderPage() {
  return (
    <>
      {/* <Breadcrumb />{" "} */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(founderJsonLd) }}
      />
      <FounderHero />
      <AboutBio />
      <AnswerSummary />
      <StatsCards />
      {/* // <FounderExperience /> */}
      <JourneyTimeline />
      <LocationsMap />
      <Faq />
      <FounderCTA />
    </>
  );
}
