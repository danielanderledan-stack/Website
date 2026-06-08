// SITE TEMPLATE ENGINE — prepended into the deployed bundle at build time.
// New model: the AI returns a LEAN config (siteType + identity + about/services copy
// + reviews). Everything visual/structural (images, icons, colours, pricing, news,
// headings, nav, footer) is PRESET per trade here. __expandSiteConfig() merges the
// lean config with its trade pack and returns the full schema the renderer consumes.
//
// LEAN INPUT (what the AI generates):
// { siteType, businessName, suburb, phone, email, address, tagline,
//   aboutText, servicesText,
//   services: [{title, desc} x6],
//   reviews:  [{text, name, role} x3] }

function __expandSiteConfig(c){
  c = c || {};

  function U(id, w, h){ return "https://images.unsplash.com/photo-" + id + "?w=" + w + "&h=" + h + "&fit=crop&crop=entropy&q=80&auto=format"; }
  var GENERIC = ["1497366216548-37526070297c","1521737604893-d14cc237f11d","1530124566582-a618bc2615dc","1581092160562-40aa08e78837","1572981779307-38b8cabb2407"];
  var AVATARS = ["men/32","women/44","men/67","women/68","men/12","women/25"];

  var PACKS = {
    electrician: { name:"Electrician", color:["#F4B400","244, 180, 0","#d99e00"],
      imgs:["1558449028-b53a39d100fc","1609743522653-52354461eb27","1473341304170-971dccb5ac1e","1565608438257-fac3c27beb36"],
      images:{heroSlides:["/sites/images/electrician/hero-1-owner-van.jpg","/sites/images/electrician/hero-2-switchboard.jpg","/sites/images/electrician/hero-3-downlights.jpg"],splitCtaImage:"/sites/images/electrician/splitcta-owner-phone.jpg",photoRowImages:["/sites/images/electrician/photorow-powerpoint.jpg","/sites/images/electrician/photorow-downlight.jpg","/sites/images/electrician/photorow-switchboard-tools.jpg","/sites/images/electrician/photorow-tester.jpg"],aboutImages:["/sites/images/electrician/about-owner-portrait.jpg","/sites/images/electrician/about-owner-switchboard.jpg","/sites/images/electrician/about-owner-customer.jpg"],fullWidthImage:"/sites/images/electrician/fullwidth-van-home.jpg",bannerImage:"/sites/images/electrician/banner-feature-lighting.jpg",testimonialsImage:"/sites/images/electrician/testimonial-pendants.jpg",galleryImages:["/sites/images/electrician/gallery-1-switchboard.jpg","/sites/images/electrician/gallery-2-downlights.jpg","/sites/images/electrician/gallery-3-evcharger.jpg","/sites/images/electrician/gallery-4-pendant.jpg","/sites/images/electrician/gallery-5-outdoor.jpg"],pricingBgImage:"/sites/images/electrician/pricingbg-tools-dark.jpg",blogPosts:["/sites/images/electrician/blog-1-smart-switch.jpg","/sites/images/electrician/blog-2-safety-switch.jpg","/sites/images/electrician/blog-3-led-lighting.jpg","/sites/images/electrician/blog-4-ceiling-fan.jpg"],services:["/sites/images/electrician/photorow-powerpoint.jpg","/sites/images/electrician/photorow-downlight.jpg","/sites/images/electrician/photorow-switchboard-tools.jpg","/sites/images/electrician/photorow-tester.jpg","/sites/images/electrician/gallery-2-downlights.jpg","/sites/images/electrician/banner-feature-lighting.jpg"]},
      icons:["zap","plug","lightbulb","bolt","shield","usb"],
      calc:[["Switchboard Upgrade",850],["Power Point Installation",180],["Lighting Installation",320],["Safety Inspection",150],["Rewiring (per room)",600]],
      list:[["Safety Switch Install","$220"],["Downlight Replacement","$90"],["Switchboard Upgrade","from $850"],["Fault Finding","$150/hr"]],
      news:[["When to Upgrade Your Switchboard","Old switchboards can't handle modern loads — here's how to spot the warning signs before they become hazards.","March 2026"],["Why Safety Switches Save Lives","A quick guide to RCDs and why every home needs them on all circuits.","February 2026"],["LED vs Halogen Downlights","Cut your lighting bill and heat output by making the switch — here's what to know.","January 2026"],["Signs You Need Rewiring","Flickering lights and warm outlets are red flags. Learn when it's time to call a sparky.","December 2025"]] },

    hvac: { name:"HVAC Specialist", color:["#0EA5E9","14, 165, 233","#0c87bd"],
      imgs:["1599696848652-f0ff23bc911f","1581094288338-2314dddb7ece","1621905251189-08b45d6a269e"],
      images:{heroSlides:["/sites/images/hvac/hero-1-owner-van.jpg","/sites/images/hvac/hero-2-split-install.jpg","/sites/images/hvac/hero-3-rooftop-condenser.jpg"],splitCtaImage:"/sites/images/hvac/splitcta-owner-phone.jpg",photoRowImages:["/sites/images/hvac/photorow-split-install-hands.jpg","/sites/images/hvac/photorow-refrigerant-gauges.jpg","/sites/images/hvac/photorow-ducted-vent.jpg","/sites/images/hvac/photorow-thermostat.jpg"],aboutImages:["/sites/images/hvac/about-owner-portrait.jpg","/sites/images/hvac/about-owner-condenser.jpg","/sites/images/hvac/about-owner-customer.jpg"],fullWidthImage:"/sites/images/hvac/fullwidth-van-home.jpg",bannerImage:"/sites/images/hvac/banner-living-room-split.jpg",testimonialsImage:"/sites/images/hvac/testimonial-ceiling-cassette.jpg",galleryImages:["/sites/images/hvac/gallery-1-outdoor-condenser.jpg","/sites/images/hvac/gallery-2-ceiling-ducts.jpg","/sites/images/hvac/hero-2-split-install.jpg","/sites/images/hvac/gallery-4-ducted-airhandler.jpg","/sites/images/hvac/hero-3-rooftop-condenser.jpg"],pricingBgImage:"/sites/images/hvac/pricingbg-split-dark.jpg",blogPosts:["/sites/images/hvac/blog-1-smart-control.jpg","/sites/images/hvac/blog-2-filter-compare.jpg","/sites/images/hvac/blog-3-bedroom-split.jpg","/sites/images/hvac/blog-4-maintenance.jpg"],services:["/sites/images/hvac/photorow-split-install-hands.jpg","/sites/images/hvac/photorow-refrigerant-gauges.jpg","/sites/images/hvac/photorow-ducted-vent.jpg","/sites/images/hvac/photorow-thermostat.jpg","/sites/images/hvac/gallery-2-ceiling-ducts.jpg","/sites/images/hvac/banner-living-room-split.jpg"]},
      icons:["flame","droplet","gear","shield","tool","plug"],
      calc:[["Split System Install",1400],["Ducted System Service",350],["AC Repair",220],["Heating Tune-Up",180],["Full System Install",4500]],
      list:[["Split System Service","$180"],["Gas Heater Service","$160"],["Ducted Install","from $4,500"],["Diagnostic Call-Out","$120"]],
      news:[["Prep Your AC for Summer","A pre-season service keeps your system efficient and prevents breakdowns on the hottest days.","March 2026"],["Ducted vs Split Systems","Which is right for your home? We break down cost, comfort and running expenses.","February 2026"],["Why Your Heater Smells","That burning smell on first use is usually harmless — but here's when to worry.","January 2026"],["Cutting Your Energy Bills","Simple HVAC habits that can shave hundreds off your yearly power costs.","December 2025"]] },

    plumber: { name:"Plumber", color:["#2563EB","37, 99, 235","#1e4fc4"],
      imgs:["1607472586893-edb57bdc0e39","1585704032915-c3400ca199e7","1581244277943-fe4a9c777189"],
      icons:["droplet","wrench","flame","shield","gear","tool"],
      calc:[["Blocked Drain Clearing",180],["Hot Water Install",1200],["Tap & Toilet Repair",140],["Leak Detection",160],["Bathroom Rough-In",2200]],
      list:[["Blocked Drain","from $180"],["Tap Repair","$110"],["Hot Water Unit","from $1,200"],["Emergency Call-Out","$150"]],
      news:[["Stop a Blocked Drain Early","The everyday habits silently clogging your pipes — and how to avoid a costly blockage.","March 2026"],["Gas vs Electric Hot Water","Running costs, lifespan and the best choice for your household size.","February 2026"],["Find a Hidden Leak","Unexplained high water bills? Here's how the pros track down leaks fast.","January 2026"],["Winter Pipe Protection","Prevent burst pipes and cold-snap disasters with these quick checks.","December 2025"]] },

    roofer: { name:"Roofer", color:["#B91C1C","185, 28, 28","#9c1717"],
      imgs:["1632759145351-1d592919f522","1605276374104-dee2a0ed3cd6"],
      icons:["shield","tool","droplet","hammer","gear","wrench"],
      calc:[["Roof Restoration",3500],["Gutter Replacement",1800],["Leak Repair",450],["Roof Inspection",200],["Re-Roof (full)",9000]],
      list:[["Roof Inspection","$200"],["Gutter Clean","from $250"],["Leak Repair","from $450"],["Roof Restoration","from $3,500"]],
      news:[["Spot Roof Damage Early","Catch minor issues before they become major leaks — a seasonal inspection checklist.","March 2026"],["Restoration vs Replacement","When a restoration will do and when you really need a full re-roof.","February 2026"],["Why Gutters Matter","Blocked gutters cause more structural damage than most homeowners realise.","January 2026"],["Storm-Proof Your Roof","Prepare your roof for wild weather with these pre-storm steps.","December 2025"]] },

    builder: { name:"Builder", color:["#EA580C","234, 88, 12","#c44a0a"],
      imgs:["1503387762-592deb58ef4e","1541888946425-d81bb19240f5","1504307651254-35680f356dfd","1521791136064-7986c2920216"],
      icons:["hammer","tool","shield","gear","wrench","bolt"],
      calc:[["Home Extension (per m²)",2800],["Bathroom Renovation",18000],["Kitchen Renovation",22000],["Deck Build",6500],["New Build Consult",250]],
      list:[["Site Consultation","$250"],["Bathroom Reno","from $18,000"],["Home Extension","POA"],["Deck & Pergola","from $6,500"]],
      news:[["Planning a Home Extension","From permits to budget — the key steps to a smooth extension project.","March 2026"],["Renovate or Rebuild?","How to decide which delivers better value for your property and goals.","February 2026"],["Choosing the Right Builder","The questions every homeowner should ask before signing a build contract.","January 2026"],["Sustainable Building Tips","Energy-efficient design choices that pay off for decades.","December 2025"]] },

    landscaper: { name:"Landscaper", color:["#16A34A","22, 163, 74","#128a3e"],
      imgs:["1558904541-efa843a96f01","1416879595882-3373a0480b5b","1600240644455-3edc55c375fe"],
      icons:["sun","droplet","shield","tool","gear","hammer"],
      calc:[["Garden Design",450],["Turf Laying (per m²)",18],["Retaining Wall",2400],["Irrigation System",1200],["Full Landscape Package",12000]],
      list:[["Garden Design","from $450"],["Turf Laying","$18/m²"],["Retaining Wall","from $2,400"],["Maintenance","$80/hr"]],
      news:[["Best Lawn for Melbourne","Choosing turf that survives our hot summers and cool winters.","March 2026"],["Low-Maintenance Gardens","Design ideas that look great with minimal upkeep year-round.","February 2026"],["Why Retaining Walls Fail","The drainage mistakes that wreck walls — and how the pros avoid them.","January 2026"],["Watering the Smart Way","Set up irrigation that saves water and keeps your garden thriving.","December 2025"]] },

    concreter: { name:"Concreter", color:["#475569","71, 85, 105","#3a4554"],
      imgs:["1517089152318-42ec560349c0","1590496793929-36417d3117de","1581094271901-8022df4466f9","1565008576549-57569a49371d"],
      icons:["tool","shield","gear","hammer","wrench","bolt"],
      calc:[["Driveway (per m²)",90],["Concrete Slab",4500],["Exposed Aggregate (per m²)",120],["Path & Footpath",1800],["Shed Slab",2200]],
      list:[["Plain Concrete","$80/m²"],["Exposed Aggregate","$120/m²"],["Driveway","from $4,000"],["Shed Slab","from $2,200"]],
      news:[["Exposed Aggregate Explained","Why this finish is so popular for driveways — durability, looks and cost.","March 2026"],["Curing Concrete Properly","Skipping the cure is the #1 cause of cracks. Here's how it's done right.","February 2026"],["Driveway Material Guide","Concrete vs pavers vs asphalt — pros, cons and lifespan compared.","January 2026"],["Stop Concrete Cracking","The prep and joint work that keeps your slab crack-free for years.","December 2025"]] },

    tiler: { name:"Tiler", color:["#0D9488","13, 148, 136","#0b7d72"],
      imgs:["1600566752355-35792bedcfea","1615874959474-d609969a20ed","1556909212-d5b604d0c90d","1620626011761-996317b8d101"],
      icons:["tool","gear","droplet","shield","hammer","wrench"],
      calc:[["Bathroom Tiling",2800],["Floor Tiling (per m²)",65],["Splashback",480],["Waterproofing",650],["Outdoor Paving (per m²)",80]],
      list:[["Floor Tiling","$65/m²"],["Wall Tiling","$70/m²"],["Waterproofing","from $650"],["Splashback","from $480"]],
      news:[["Large Format Tiles","Why oversized tiles are trending — and what to know before you install.","March 2026"],["Waterproofing Done Right","The hidden step that protects your bathroom from costly water damage.","February 2026"],["Grout Colour Matters","How the right grout can completely change the look of your tiling.","January 2026"],["Tiles for Wet Areas","Choosing slip-resistant, durable tiles for bathrooms and outdoors.","December 2025"]] },

    carpenter: { name:"Carpenter", color:["#92400E","146, 64, 14","#7a350b"],
      imgs:["1601564921647-b446839a013f","1504148455328-c376907d081c","1530124566582-a618bc2615dc"],
      icons:["hammer","tool","gear","shield","wrench","bolt"],
      calc:[["Custom Joinery",1800],["Decking (per m²)",250],["Door Hanging",180],["Built-In Wardrobe",2400],["Pergola Build",5500]],
      list:[["Door Hanging","$180"],["Custom Shelving","from $400"],["Decking","$250/m²"],["Built-In Robe","from $2,400"]],
      news:[["Timber Decking Care","Keep your deck looking new with the right seasonal maintenance routine.","March 2026"],["Custom vs Flat-Pack Joinery","Why bespoke cabinetry is worth it for fit, finish and longevity.","February 2026"],["Choosing Decking Timber","Hardwood, treated pine or composite — which suits your budget and style.","January 2026"],["Pergola Planning Tips","Permits, materials and design ideas for the perfect outdoor space.","December 2025"]] }
  };

  var GENERIC_PACK = { name:"Trade Professional", color:["#1E3A8A","30, 58, 138","#1A2F75"],
    imgs:GENERIC.slice(), icons:["wrench","gear","shield","tool","bolt","hammer"],
    calc:[["Standard Service",150],["Call-Out",90],["Major Job",800],["Inspection",120],["Custom Quote",250]],
    list:[["Call-Out Fee","$90"],["Hourly Rate","$110/hr"],["Standard Service","from $150"],["Major Works","POA"]],
    news:[["Choosing a Local Tradie","What to look for to make sure you hire a reliable, qualified professional.","March 2026"],["Getting an Accurate Quote","How to compare quotes properly and avoid surprise costs.","February 2026"],["Maintenance Saves Money","Why regular upkeep beats expensive emergency repairs every time.","January 2026"],["Questions to Ask First","The key things to confirm before any tradesperson starts work.","December 2025"]] };

  var st = String(c.siteType || c.trade || "").toLowerCase().replace(/[^a-z]/g, "");
  var pack = PACKS[st];
  if (!pack){
    // fuzzy-resolve from siteType / businessName / trade / tagline so a wrong
    // siteType (e.g. "trade") still lands on the right pack via keywords
    var hint = (String(c.siteType||"")+" "+String(c.businessName||"")+" "+String(c.trade||"")+" "+String(c.tagline||"")).toLowerCase();
    var AL = {electric:"electrician",plumb:"plumber",roof:"roofer",concret:"concreter",cement:"concreter",tiling:"tiler",tiler:"tiler",carpen:"carpenter",joiner:"carpenter",cabinet:"carpenter",decking:"carpenter",landscap:"landscaper",garden:"landscaper",paving:"landscaper",hvac:"hvac",aircon:"hvac",conditioning:"hvac",heating:"hvac",cooling:"hvac",refriger:"hvac",builder:"builder",building:"builder",construct:"builder",renovat:"builder"};
    for (var ky in AL){ if (hint.indexOf(ky) !== -1){ pack = PACKS[AL[ky]]; break; } }
  }
  pack = pack || GENERIC_PACK;
  var pool = pack.imgs.concat(GENERIC);
  function P(i){ return pool[i % pool.length]; }

  var biz = c.businessName || c.logoPrefix || pack.name;
  var trade = c.trade || pack.name;
  var suburb = c.suburb || "";
  var where = suburb ? (" in " + suburb) : "";

  // headings come from the AI (old-site branding); split last word as the highlight
  function sh(str){ if(!str) return null; var w=String(str).trim().split(/\s+/); if(w.length<2) return {s:"",h:String(str),e:""}; return {s:w.slice(0,-1).join(" ")+" ",h:w[w.length-1],e:""}; }
  var AH=sh(c.aboutHeading), SVH=sh(c.servicesHeading), TH=sh(c.testimonialsHeading), BH=sh(c.blogHeading);
  var aiHero = Array.isArray(c.heroSlides) ? c.heroSlides : [];
  var H='/sites/images/hvac/';
  var SHARED_IMAGES={
    heroSlides:[H+'hero-1-owner-van.jpg',H+'hero-2-split-install.jpg',H+'hero-3-rooftop-condenser.jpg'],
    splitCtaImage:H+'splitcta-owner-phone.jpg',
    photoRowImages:[H+'photorow-split-install-hands.jpg',H+'photorow-refrigerant-gauges.jpg',H+'photorow-ducted-vent.jpg',H+'photorow-thermostat.jpg'],
    aboutImages:[H+'about-owner-portrait.jpg',H+'about-owner-condenser.jpg',H+'about-owner-customer.jpg'],
    fullWidthImage:H+'fullwidth-van-home.jpg',
    bannerImage:H+'banner-living-room-split.jpg',
    testimonialsImage:H+'testimonial-ceiling-cassette.jpg',
    galleryImages:[H+'gallery-1-outdoor-condenser.jpg',H+'gallery-2-ceiling-ducts.jpg',H+'hero-2-split-install.jpg',H+'gallery-4-ducted-airhandler.jpg',H+'hero-3-rooftop-condenser.jpg'],
    pricingBgImage:H+'pricingbg-split-dark.jpg',
    blogPosts:[H+'blog-1-smart-control.jpg',H+'blog-2-filter-compare.jpg',H+'blog-3-bedroom-split.jpg',H+'blog-4-maintenance.jpg'],
    services:[H+'photorow-split-install-hands.jpg',H+'photorow-refrigerant-gauges.jpg',H+'photorow-ducted-vent.jpg',H+'photorow-thermostat.jpg',H+'gallery-2-ceiling-ducts.jpg',H+'banner-living-room-split.jpg']
  };
  var IMG = SHARED_IMAGES;
  function gi(key, idx, w, h){ return (IMG && IMG[key]) ? IMG[key] : U(P(idx), w, h); }
  function giList(key, idxs, w, h, alt){ if (IMG && Array.isArray(IMG[key])) return IMG[key].map(function(s){ return { src:s, alt:alt }; }); return idxs.map(function(i){ return { src:U(P(i),w,h), alt:alt }; }); }
  function hero(i,dt,ds){ var h=aiHero[i]||{}; var im=(IMG && IMG.heroSlides && IMG.heroSlides[i])?IMG.heroSlides[i]:U(P(i),1600,900); return { img:im, title:h.title||h.heading||dt, sub:h.sub||h.subtitle||ds }; }

  // AI services (title + desc); icons + images preset by slot
  var aiServices = Array.isArray(c.services) ? c.services : [];
  var services = [];
  for (var i = 0; i < 6; i++){
    var s = aiServices[i] || {};
    services.push({
      icon: pack.icons[i % pack.icons.length],
      title: s.title || s.name || (pack.name + " Service " + (i + 1)),
      desc: s.desc || s.description || ("Professional " + pack.name.toLowerCase() + " services you can rely on" + where + "."),
      image: (IMG && IMG.services && IMG.services[i]) ? IMG.services[i] : U(P(i + 1), 600, 400)
    });
  }

  var aiReviews = Array.isArray(c.reviews) ? c.reviews : (Array.isArray(c.testimonials) ? c.testimonials : []);
  var testimonials = [];
  for (var r = 0; r < 3; r++){
    var t = aiReviews[r] || {};
    testimonials.push({
      text: t.text || "Fantastic service from start to finish — professional, on time and great value. Highly recommend to anyone" + where + ".",
      name: t.name || "Happy Customer",
      role: t.role || "Customer",
      avatar: "https://randomuser.me/api/portraits/" + AVATARS[r % AVATARS.length] + ".jpg"
    });
  }

  var calculatorServices = pack.calc.map(function(p){ return { label: p[0], base: p[1] }; });
  var priceList = pack.list.map(function(p){ return { name: p[0], price: p[1] }; });
  var blogPosts = pack.news.map(function(n, i){ return { img: (IMG && IMG.blogPosts && IMG.blogPosts[i]) ? IMG.blogPosts[i] : U(P(i + 1), 600, 400), date: n[2], title: n[0], excerpt: n[1] }; });
  function imgObjs(idxs, alt){ return idxs.map(function(i){ return { src: U(P(i), 600, 400), alt: alt }; }); }

  return {
    primaryColor: c.primaryColor || pack.color[0],
    primaryColorRgb: c.primaryColorRgb || pack.color[1],
    primaryColorHover: c.primaryColorHover || pack.color[2],
    secondaryColor: c.secondaryColor || "#1a1a1a",
    logoPrefix: c.logoPrefix || biz,
    logoCircleLetter: "",
    logoTagline: c.tagline || c.logoTagline || (pack.name + (suburb ? (" • " + suburb) : "")),
    trade: trade,
    suburb: suburb,
    phone: c.phone || "",
    email: c.email || "",
    address: c.address || "",
    navLinks: ["Home", "About Us", "Services", "Prices", "Blog", "Contact"],
    navCtaLabel: "Get a Quote",
    heroSlides: [
      hero(0, c.tagline || ("Trusted " + pack.name + where), "Quality workmanship, every time"),
      hero(1, "Reliable & Professional", suburb ? ("Proudly serving " + suburb) : "Fully licensed & insured"),
      hero(2, "Get the Job Done Right", "Free quotes — no obligation")
    ],
    heroCtaLabel: "Book Now",
    splitCtaLines: c.ctaHeading ? (Array.isArray(c.ctaHeading) ? c.ctaHeading : [c.ctaHeading])
                 : (Array.isArray(c.splitCtaLines) ? c.splitCtaLines
                 : ["Don't wait —", (suburb ? (suburb + "'s trusted ") : "your trusted ") + pack.name.toLowerCase() + "s", "are ready to help.", "Get your free quote today."]),
    splitCtaSubtext: "",
    splitCtaImage: gi('splitCtaImage', 2, 900, 700),
    photoRowImages: giList('photoRowImages', [1, 2, 3, 0], 600, 400, pack.name),
    aboutHeadingStart: AH ? AH.s : "Do you need a",
    aboutHeadingHighlight: AH ? AH.h : (pack.name + "?"),
    aboutHeadingEnd: AH ? AH.e : "Look no further!",
    aboutSubheading: c.aboutSubheading || ("Your Local Experts" + where),
    aboutText: c.aboutText || ("With years of hands-on experience" + where + ", our licensed team delivers reliable, high-quality " + pack.name.toLowerCase() + " work. We pride ourselves on honest advice, fair pricing and turning up on time, every time."),
    aboutStatLabel: "Happy Customers",
    aboutStatValue: 90,
    aboutCtaLabel: "Read More",
    aboutImages: giList('aboutImages', [3, 0, 1], 600, 400, pack.name),
    fullWidthImage: gi('fullWidthImage', 0, 1920, 700),
    fullWidthImageAlt: pack.name + " at work",
    servicesHeadingStart: SVH ? SVH.s : "Our Professional",
    servicesHeadingHighlight: SVH ? SVH.h : "Services",
    servicesSubheading: c.servicesSubheading || "What We Offer",
    servicesText: c.servicesText || ("From small jobs to major projects, we offer a full range of " + pack.name.toLowerCase() + " services" + where + ". Quality materials, expert workmanship and a satisfaction guarantee on every job."),
    services: services,
    bannerHeading: c.bannerHeading || ("Do you need a " + pack.name + "?"),
    bannerSubheading: c.bannerSubheading || "Look no further — our team is here to help.",
    bannerCtaLabel: "View All Services",
    bannerImage: gi('bannerImage', 1, 700, 900),
    testimonialsHeadingStart: TH ? TH.s : "We Deliver",
    testimonialsHeadingHighlight: TH ? TH.h : "Quality",
    testimonialsHeadingEnd: TH ? TH.e : "Results",
    testimonialsSubheading: c.testimonialsSubheading || "Honest Work, Fair Prices",
    testimonialsImage: gi('testimonialsImage', 2, 700, 500),
    testimonials: testimonials,
    galleryImages: giList('galleryImages', [0, 1, 2, 3, 0], 600, 400, pack.name),
    pricingBgImage: gi('pricingBgImage', 0, 1920, 800),
    calculatorTitle: "Price Estimator",
    calculatorServicesLabel: "Service you need",
    calculatorDistanceLabel: "Distance from us",
    calculatorUrgencyLabel: "Urgent Job?",
    calculatorTypeLabel: "Job size",
    calculatorTypes: ["Standard", "Large"],
    calculatorSelectDefault: "Select Option",
    calculatorUrgencyYes: "Yes",
    calculatorUrgencyNo: "No",
    distanceUnit: "km",
    currency: "$",
    calculatorServices: calculatorServices,
    priceListHeadingLine1: "Competitive Pricing &",
    priceListHeadingLine2: "Service Packages",
    priceListSubheading: "Fair & Transparent",
    priceList: priceList,
    urgencyBadgeText: "Same Day Service",
    professionalText: "Licensed " + pack.name,
    finalPriceLabel: "Estimated Price",
    quoteCtaLabel: "Get a Quote",
    blogHeadingStart: BH ? BH.s : "Latest",
    blogHeadingHighlight: BH ? BH.h : "News",
    blogHeadingEnd: BH ? BH.e : "& Tips",
    blogSubheading: c.blogSubheading || "Advice & Industry Updates",
    blogPosts: blogPosts,
    contactHeading: c.contactHeading || "Get in Touch Now!",
    contactSubheading: c.contactSubheading || ("We're Here to Help" + where),
    contactCtaLabel: "Get a Quote",
    footerCopyright: biz + (suburb ? (" — " + suburb) : ""),
    footerNewsletterNote: "* Seasonal tips and special offers",
    footerColumns: [
      { heading: "Our Services", links: services.map(function(s){ return s.title; }) },
      { heading: "Useful Links", links: ["Home", "About Us", "Services", "Pricing", "Blog", "Contact"] },
      { heading: "Company", links: ["Licensed & Insured", "Free Quotes", "Satisfaction Guarantee", "Local & Trusted"] }
    ],
    footerBottomLinks: ["Home", "About Us", "Services"]
  };
}
