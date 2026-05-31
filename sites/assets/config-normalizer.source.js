// SOURCE of the config normalizer prepended into the deployed bundle at build time.
// Maps legacy/old-schema site configs (nested colors/images/pricing, services[].name,
// pricing.calculator[].basePrice, blog[]) to the full 80-field schema (sample-config.json),
// filling presentational defaults so EVERY uploaded JSON renders. Edit here, then re-inject.
//
// Images: the AI generator uses many field-name variants (images.hero | heroImage,
// images.about | aboutImage, services[].image, blog|blogPosts|blogs, etc.) and many
// configs still point at the RETIRED source.unsplash.com endpoint (HTTP 503). This
// normalizer reads all the aliases and rewrites dead/missing images to working
// loremflickr URLs (preserving the original keywords), so every site shows images.

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

  // ---- image helpers ----------------------------------------------------
  function kw(hint, max){
    var q = String(hint || trade).toLowerCase().replace(/[^a-z0-9, ]/g, " ").trim();
    var parts = q.split(/[\s,]+/).filter(Boolean).slice(0, max || 2);
    return parts.join(",") || "business";
  }
  // working placeholder for missing images
  function ph(hint, w, h, seed){
    return "https://loremflickr.com/" + (w || 1200) + "/" + (h || 800) + "/" + kw(hint) + "?lock=" + (seed || 1);
  }
  // pass through good URLs; rewrite dead source.unsplash.com ones; fill blanks
  function fixUrl(u, hint, w, h, seed){
    if (!u || typeof u !== "string") return ph(hint, w, h, seed);
    if (u.indexOf("source.unsplash.com") !== -1){
      var dim = u.match(/(\d{2,4})x(\d{2,4})/);
      var ww = dim ? dim[1] : (w || 1200);
      var hh = dim ? dim[2] : (h || 800);
      var q = (u.split("?")[1] || "").split("&")[0];
      try { q = decodeURIComponent(q); } catch (e) {}
      return "https://loremflickr.com/" + ww + "/" + hh + "/" + kw(q || hint) + "?lock=" + (seed || 1);
    }
    return u;
  }

  // pool of service/extra images, gathered from every known location
  var imgServicesRaw = images.services || c.serviceImages || c.servicesImages;
  var imgArr = Array.isArray(imgServicesRaw) ? imgServicesRaw.slice() : (imgServicesRaw ? [imgServicesRaw] : []);
  (c.services || []).forEach(function(s){ if (s && (s.image || s.img)) imgArr.push(s.image || s.img); });
  function poolImg(i, seed, hint){ return fixUrl(imgArr[i], hint || trade, 600, 400, seed || (10 + i)); }
  function imgObjs(n, alt, baseSeed){
    var a = [];
    for (var k = 0; k < n; k++){ a.push({ src: poolImg(k, (baseSeed || 50) + k, alt), alt: alt }); }
    return a;
  }

  var heroSlide0 = (Array.isArray(c.heroSlides) && c.heroSlides[0]) ? (c.heroSlides[0].img || c.heroSlides[0].image) : null;
  var heroImg  = fixUrl(images.hero  || c.heroImage  || c.heroImg  || heroSlide0 || imgArr[0], trade, 1200, 800, 1);
  var aboutImg = fixUrl(images.about || c.aboutImage || c.aboutImg || imgArr[1] || imgArr[0], trade, 1200, 800, 2);

  // ---- structured collections ------------------------------------------
  var services = (c.services || []).map(function(s, idx){
    return {
      icon: s.icon || "wrench",
      title: s.title || s.name || ("Service " + (idx + 1)),
      desc: s.desc || s.description || "",
      image: fixUrl(s.image || s.img, s.title || s.name || trade, 600, 400, 30 + idx)
    };
  });

  var testimonials = (c.testimonials || []).map(function(t){
    return {
      text: t.text || "",
      name: t.name || "",
      role: t.role || "Customer",
      avatar: (t.avatar && t.avatar.indexOf("source.unsplash.com") === -1) ? t.avatar : "https://randomuser.me/api/portraits/lego/1.jpg"
    };
  });

  var pricing = c.pricing || {};
  var calcRaw = present("calculatorServices") ? c.calculatorServices
              : (c.calculator || pricing.calculator || c.pricingCalculator || []);
  var calculatorServices = (calcRaw || []).map(function(p){
    return { label: p.label || p.name || "Service", base: (p.base != null ? p.base : (p.basePrice != null ? p.basePrice : 100)) };
  });
  if (calculatorServices.length === 0) calculatorServices = [{ label: trade + " Service", base: 100 }];

  var priceRaw = present("priceList") ? c.priceList : (pricing.priceList || c.priceList || []);
  var priceList = (priceRaw || []).map(function(p){
    return { name: p.name || p.label || "Service", price: (p.price != null ? p.price : "") };
  });

  var blogRaw = present("blogPosts") ? c.blogPosts : (c.blog || c.blogs || []);
  var blogPosts = (blogRaw || []).map(function(b, idx){
    return { img: fixUrl(b.img || b.image, b.title || trade, 600, 400, 40 + idx), date: b.date || "", title: b.title || "", excerpt: b.excerpt || "" };
  });

  var heroSlides = present("heroSlides")
    ? c.heroSlides.map(function(sl, i){
        return { img: fixUrl(sl.img || sl.image, sl.title || trade, 1200, 800, 1 + i), title: sl.title || ("Trusted " + trade), sub: sl.sub || sl.subtitle || "" };
      })
    : [
        { img: heroImg,           title: c.tagline || ("Trusted " + trade), sub: c.bannerSubheading || (suburb ? ("Serving " + suburb) : "Quality you can rely on") },
        { img: aboutImg,          title: "Quality " + trade,                sub: c.aboutSubheading || "Reliable & Professional" },
        { img: poolImg(2, 3),     title: "Local Experts",                   sub: suburb ? ("Proudly serving " + suburb) : "Get in touch today" }
      ];

  function fixObjs(arr, hint, baseSeed){
    return (arr || []).map(function(o, i){
      if (typeof o === "string") return { src: fixUrl(o, hint, 600, 400, baseSeed + i), alt: hint };
      return { src: fixUrl(o.src || o.image || o.img, o.alt || hint, 600, 400, baseSeed + i), alt: o.alt || hint };
    });
  }

  return {
    primaryColor: c.primaryColor || colors.primaryColor || "#1E3A8A",
    primaryColorRgb: c.primaryColorRgb || colors.primaryColorRgb || "30, 58, 138",
    primaryColorHover: c.primaryColorHover || colors.primaryColorHover || "#1A2F75",
    secondaryColor: c.secondaryColor || colors.secondaryColor || "#1a1a1a",
    logoPrefix: c.logoPrefix || c.logoText || String(biz),
    logoCircleLetter: c.logoCircleLetter || "",
    logoTagline: c.logoTagline || c.tagline || trade,
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
    splitCtaImage: fixUrl(c.splitCtaImage || aboutImg, trade, 900, 700, 4),
    photoRowImages: present("photoRowImages") ? fixObjs(c.photoRowImages, trade, 60) : imgObjs(4, trade, 60),
    aboutHeadingStart: def("aboutHeadingStart", "Do you need a"),
    aboutHeadingHighlight: def("aboutHeadingHighlight", trade + " ?"),
    aboutHeadingEnd: def("aboutHeadingEnd", "Look no further!"),
    aboutSubheading: def("aboutSubheading", "Your Local Experts"),
    aboutText: c.aboutText || "",
    aboutStatLabel: def("aboutStatLabel", "Returning Customers"),
    aboutStatValue: (c.aboutStatValue != null ? c.aboutStatValue : 90),
    aboutCtaLabel: def("aboutCtaLabel", "Read More"),
    aboutImages: present("aboutImages") ? fixObjs(c.aboutImages, trade, 70) : imgObjs(3, trade, 70),
    fullWidthImage: fixUrl(c.fullWidthImage || heroImg, trade, 1920, 800, 5),
    fullWidthImageAlt: def("fullWidthImageAlt", trade + " professional at work"),
    servicesHeadingStart: def("servicesHeadingStart", "Our Professional"),
    servicesHeadingHighlight: def("servicesHeadingHighlight", "Services"),
    servicesSubheading: def("servicesSubheading", "What We Offer"),
    servicesText: c.servicesText || "",
    services: services,
    bannerHeading: def("bannerHeading", "Do you need a " + trade + "?"),
    bannerSubheading: def("bannerSubheading", "Look no further — our team is here to help."),
    bannerCtaLabel: def("bannerCtaLabel", "View All Services"),
    bannerImage: fixUrl(c.bannerImage || images.banner || aboutImg, trade, 600, 800, 6),
    testimonialsHeadingStart: def("testimonialsHeadingStart", "We Deliver"),
    testimonialsHeadingHighlight: def("testimonialsHeadingHighlight", "Quality"),
    testimonialsHeadingEnd: def("testimonialsHeadingEnd", "Results"),
    testimonialsSubheading: def("testimonialsSubheading", "Honest Work, Fair Prices"),
    testimonialsImage: fixUrl(c.testimonialsImage || aboutImg, trade, 700, 500, 7),
    testimonials: testimonials,
    galleryImages: present("galleryImages") ? fixObjs(c.galleryImages, trade, 80) : imgObjs(5, trade, 80),
    pricingBgImage: fixUrl(c.pricingBgImage || heroImg, trade, 1920, 800, 8),
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
