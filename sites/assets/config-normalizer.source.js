// SOURCE of the config normalizer prepended into the deployed bundle at build time.
// Maps legacy/old-schema site configs (nested colors/images/pricing, services[].name,
// pricing.calculator[].basePrice, blog[]) to the full 80-field schema (sample-config.json),
// filling presentational defaults so EVERY uploaded JSON renders. Edit here, then re-inject.

function __normalizeSiteConfig(c){
  c = c || {};
  function present(k){
    var v = c[k];
    if (v === undefined || v === null) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  }
  function def(k, fallback){ return present(k) ? c[k] : fallback; }

  var colors = c.colors || {};
  var images = c.images || {};
  var biz = c.businessName || c.logoPrefix || c.trade || "Our Business";
  var trade = c.trade || "Services";
  var suburb = c.suburb || "";
  var words = String(biz).trim().split(/\s+/).filter(Boolean);
  var firstWord = words[0] || String(biz);

  var imgServices = images.services;
  var imgArr = Array.isArray(imgServices) ? imgServices : (imgServices ? [imgServices] : []);
  function uns(q){ return "https://source.unsplash.com/1200x800/?" + encodeURIComponent(q || trade); }
  var heroImg = images.hero || imgArr[0] || uns(trade);
  var aboutImg = images.about || heroImg;
  function img(i, fallback){ return imgArr[i] || fallback; }
  function imgObjs(n, alt){
    var a = [];
    for (var k = 0; k < n; k++){ a.push({ src: img(k, k % 2 ? aboutImg : heroImg), alt: alt }); }
    return a;
  }

  var services = (c.services || []).map(function(s, idx){
    return {
      icon: s.icon || "wrench",
      title: s.title || s.name || ("Service " + (idx + 1)),
      desc: s.desc || s.description || "",
      image: s.image || img(idx, aboutImg)
    };
  });

  var testimonials = (c.testimonials || []).map(function(t){
    return {
      text: t.text || "",
      name: t.name || "",
      role: t.role || "Customer",
      avatar: t.avatar || "https://randomuser.me/api/portraits/lego/1.jpg"
    };
  });

  var pricing = c.pricing || {};
  var calcRaw = present("calculatorServices") ? c.calculatorServices : (pricing.calculator || []);
  var calculatorServices = (calcRaw || []).map(function(p){
    return { label: p.label || p.name || "Service", base: (p.base != null ? p.base : (p.basePrice != null ? p.basePrice : 100)) };
  });
  if (calculatorServices.length === 0) calculatorServices = [{ label: trade + " Service", base: 100 }];

  var priceRaw = present("priceList") ? c.priceList : (pricing.priceList || []);
  var priceList = (priceRaw || []).map(function(p){
    return { name: p.name || p.label || "Service", price: (p.price != null ? p.price : "") };
  });

  var blogRaw = present("blogPosts") ? c.blogPosts : (c.blog || []);
  var blogPosts = (blogRaw || []).map(function(b, idx){
    return { img: b.img || img(idx, heroImg), date: b.date || "", title: b.title || "", excerpt: b.excerpt || "" };
  });

  var heroSlides = present("heroSlides") ? c.heroSlides : [
    { img: heroImg,        title: c.tagline || ("Trusted " + trade), sub: c.bannerSubheading || (suburb ? ("Serving " + suburb) : "Quality you can rely on") },
    { img: aboutImg,       title: "Quality " + trade,                sub: c.aboutSubheading || "Reliable & Professional" },
    { img: img(1, heroImg),  title: "Local Experts",                  sub: suburb ? ("Proudly serving " + suburb) : "Get in touch today" }
  ];

  return {
    primaryColor: c.primaryColor || colors.primaryColor || "#1E3A8A",
    primaryColorRgb: c.primaryColorRgb || colors.primaryColorRgb || "30, 58, 138",
    primaryColorHover: c.primaryColorHover || colors.primaryColorHover || "#1A2F75",
    secondaryColor: c.secondaryColor || colors.secondaryColor || "#1a1a1a",
    logoPrefix: c.logoPrefix || firstWord.toUpperCase(),
    logoCircleLetter: c.logoCircleLetter || (firstWord.charAt(0).toUpperCase() || "A"),
    logoTagline: c.logoTagline || c.tagline || (words.length > 1 ? words.slice(1).join(" ").toUpperCase() : trade),
    trade: trade,
    suburb: suburb,
    phone: c.phone || "",
    email: c.email || "",
    address: c.address || "",
    navLinks: def("navLinks", ["Home", "About Us", "Services", "Prices", "Blog", "Contact"]),
    navCtaLabel: def("navCtaLabel", "Get a Quote"),
    heroSlides: heroSlides,
    heroCtaLabel: def("heroCtaLabel", "Get a Quote"),
    splitCtaLines: def("splitCtaLines", ["Don't wait!", "Get in touch today and let us", "get the job done — fast and guaranteed."]),
    splitCtaSubtext: def("splitCtaSubtext", "Job Done Right"),
    splitCtaImage: c.splitCtaImage || aboutImg,
    photoRowImages: present("photoRowImages") ? c.photoRowImages : imgObjs(4, trade),
    aboutHeadingStart: def("aboutHeadingStart", "Do you need a"),
    aboutHeadingHighlight: def("aboutHeadingHighlight", trade + " ?"),
    aboutHeadingEnd: def("aboutHeadingEnd", "Look no further!"),
    aboutSubheading: def("aboutSubheading", "Your Local Experts"),
    aboutText: c.aboutText || "",
    aboutStatLabel: def("aboutStatLabel", "Returning Customers"),
    aboutStatValue: (c.aboutStatValue != null ? c.aboutStatValue : 90),
    aboutCtaLabel: def("aboutCtaLabel", "Read More"),
    aboutImages: present("aboutImages") ? c.aboutImages : imgObjs(3, trade),
    fullWidthImage: c.fullWidthImage || heroImg,
    fullWidthImageAlt: def("fullWidthImageAlt", trade + " professional at work"),
    servicesHeadingStart: def("servicesHeadingStart", "Our Professional"),
    servicesHeadingHighlight: def("servicesHeadingHighlight", "Services"),
    servicesSubheading: def("servicesSubheading", "What We Offer"),
    servicesText: c.servicesText || "",
    services: services,
    bannerHeading: def("bannerHeading", "Do you need a " + trade + "?"),
    bannerSubheading: def("bannerSubheading", "Look no further — our team is here to help."),
    bannerCtaLabel: def("bannerCtaLabel", "View All Services"),
    bannerImage: c.bannerImage || aboutImg,
    testimonialsHeadingStart: def("testimonialsHeadingStart", "We Deliver"),
    testimonialsHeadingHighlight: def("testimonialsHeadingHighlight", "Quality"),
    testimonialsHeadingEnd: def("testimonialsHeadingEnd", "Results"),
    testimonialsSubheading: def("testimonialsSubheading", "Honest Work, Fair Prices"),
    testimonialsImage: c.testimonialsImage || aboutImg,
    testimonials: testimonials,
    galleryImages: present("galleryImages") ? c.galleryImages : imgObjs(5, trade),
    pricingBgImage: c.pricingBgImage || heroImg,
    calculatorTitle: def("calculatorTitle", "Price Estimator"),
    calculatorServicesLabel: def("calculatorServicesLabel", "Service you need"),
    calculatorDistanceLabel: def("calculatorDistanceLabel", "Distance from us"),
    calculatorUrgencyLabel: def("calculatorUrgencyLabel", "Urgent Job?"),
    calculatorTypeLabel: def("calculatorTypeLabel", "Job type"),
    calculatorTypes: def("calculatorTypes", ["Standard", "Complex"]),
    calculatorSelectDefault: def("calculatorSelectDefault", "Select Option"),
    calculatorUrgencyYes: def("calculatorUrgencyYes", "Yes"),
    calculatorUrgencyNo: def("calculatorUrgencyNo", "No"),
    distanceUnit: c.distanceUnit || "km",
    currency: c.currency || "$",
    calculatorServices: calculatorServices,
    priceListHeadingLine1: def("priceListHeadingLine1", "Competitive Pricing &"),
    priceListHeadingLine2: def("priceListHeadingLine2", "Service Packages"),
    priceListSubheading: def("priceListSubheading", "Fair & Transparent"),
    priceList: priceList,
    urgencyBadgeText: def("urgencyBadgeText", "Same Day Service"),
    professionalText: def("professionalText", "Certified " + trade),
    finalPriceLabel: def("finalPriceLabel", "Estimated Price"),
    quoteCtaLabel: def("quoteCtaLabel", "Get a Quote"),
    blogHeadingStart: def("blogHeadingStart", "Latest"),
    blogHeadingHighlight: def("blogHeadingHighlight", "News"),
    blogHeadingEnd: def("blogHeadingEnd", "& Updates"),
    blogSubheading: def("blogSubheading", "Tips, Advice & Industry Updates"),
    blogPosts: blogPosts,
    contactHeading: def("contactHeading", "Get in Touch Now!"),
    contactSubheading: def("contactSubheading", "We're Here to Help"),
    contactCtaLabel: def("contactCtaLabel", "Get a Quote"),
    footerCopyright: c.footerCopyright || (biz + (suburb ? (" — " + suburb) : "")),
    footerNewsletterNote: def("footerNewsletterNote", "* Updates and news"),
    footerColumns: present("footerColumns") ? c.footerColumns : [
      { heading: "Services", links: services.slice(0, 6).map(function(s){ return s.title; }) },
      { heading: "Useful Links", links: ["Sitemap", "Legal Note", "Privacy & Policy", "Cookie Info"] },
      { heading: "Company", links: ["About Us", "Services", "Pricing", "Contact"] }
    ],
    footerBottomLinks: def("footerBottomLinks", ["Home", "About Us", "Services"])
  };
}
