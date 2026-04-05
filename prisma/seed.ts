import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./dev.db" })
const prisma = new PrismaClient({ adapter })

// 46 bidable trade categories derived from internal cost code structure
const TRADES = [
  // Division 2 — Site Work
  { name: "Site Work / Earthwork",             costCode: "2.003",  csiCode: "31 00 00" },
  { name: "Site Utilities",                    costCode: "2.020",  csiCode: "33 00 00" },
  { name: "Erosion Control / SWPPP",           costCode: "2.040",  csiCode: "31 25 00" },
  { name: "Landscaping",                       costCode: "2.060",  csiCode: "32 90 00" },
  { name: "Irrigation",                        costCode: "2.063",  csiCode: "32 84 00" },
  // Division 3 — Concrete
  { name: "Concrete — Foundations",            costCode: "3.030",  csiCode: "03 30 00" },
  { name: "Concrete — Flatwork & Slabs",       costCode: "3.010",  csiCode: "03 35 00" },
  { name: "Concrete — Paving & Curbs",         costCode: "3.004",  csiCode: "32 13 00" },
  { name: "Decorative Concrete",               costCode: "3.040",  csiCode: "03 35 43" },
  { name: "Precast Concrete",                  costCode: "3.044",  csiCode: "03 40 00" },
  // Division 4 — Masonry
  { name: "Masonry — Brick",                   costCode: "4.010",  csiCode: "04 21 00" },
  { name: "Masonry — Block",                   costCode: "4.020",  csiCode: "04 22 00" },
  { name: "Stone & Cast Stone",                costCode: "4.030",  csiCode: "04 40 00" },
  // Division 5 — Metals
  { name: "Structural Steel",                  costCode: "5.002",  csiCode: "05 10 00" },
  { name: "Miscellaneous & Ornamental Metals", costCode: "5.050",  csiCode: "05 50 00" },
  // Division 6 — Construction / Wood
  { name: "Fencing",                           costCode: "6.009",  csiCode: "32 31 00" },
  { name: "Rough Framing",                     costCode: "6.001",  csiCode: "06 10 00" },
  { name: "Finish Carpentry",                  costCode: "6.020",  csiCode: "06 20 00" },
  { name: "Millwork & Casework",               costCode: "6.030",  csiCode: "06 40 00" },
  { name: "Countertops",                       costCode: "6.050",  csiCode: "06 61 00" },
  // Division 7 — Thermal & Moisture
  { name: "Waterproofing",                     costCode: "7.001",  csiCode: "07 10 00" },
  { name: "Siding & Exterior Cladding",        costCode: "7.010",  csiCode: "07 40 00" },
  { name: "Roofing",                           costCode: "7.020",  csiCode: "07 50 00" },
  { name: "Sheet Metal & Gutters",             costCode: "7.030",  csiCode: "07 60 00" },
  { name: "Insulation",                        costCode: "7.040",  csiCode: "07 20 00" },
  { name: "Caulking & Sealants",               costCode: "7.060",  csiCode: "07 90 00" },
  // Division 8 — Doors & Windows
  { name: "Doors & Frames",                    costCode: "8.001",  csiCode: "08 10 00" },
  { name: "Door Hardware",                     costCode: "8.010",  csiCode: "08 71 00" },
  { name: "Overhead Doors",                    costCode: "8.005",  csiCode: "08 33 00" },
  { name: "Windows & Storefronts",             costCode: "8.021",  csiCode: "08 40 00" },
  { name: "Curtainwall / Glass & Glazing",     costCode: "8.030",  csiCode: "08 44 00" },
  // Division 9 — Finishes
  { name: "Drywall",                           costCode: "9.001",  csiCode: "09 29 00" },
  { name: "Painting",                          costCode: "9.010",  csiCode: "09 90 00" },
  { name: "Flooring — Carpet",                 costCode: "9.023",  csiCode: "09 68 00" },
  { name: "Flooring — Tile",                   costCode: "9.026",  csiCode: "09 30 00" },
  { name: "Flooring — Hard Surface",           costCode: "9.029",  csiCode: "09 65 00" },
  { name: "Acoustical Ceilings",               costCode: "9.050",  csiCode: "09 50 00" },
  // Division 10 — Specialties
  { name: "Signage",                           costCode: "10.001", csiCode: "10 14 00" },
  { name: "Specialties & Accessories",         costCode: "10.010", csiCode: "10 00 00" },
  // Division 13 — Special Construction
  { name: "Fire Suppression",                  costCode: "13.005", csiCode: "21 00 00" },
  { name: "Metal Building Systems",            costCode: "13.006", csiCode: "13 34 00" },
  // Division 14 — Conveying Systems
  { name: "Elevators",                         costCode: "14.003", csiCode: "14 20 00" },
  // Division 15 — Mechanical & Plumbing
  { name: "Plumbing",                          costCode: "15.001", csiCode: "22 00 00" },
  { name: "HVAC & Mechanical",                 costCode: "15.010", csiCode: "23 00 00" },
  // Division 16 — Electrical
  { name: "Electrical",                        costCode: "16.010", csiCode: "26 00 00" },
  { name: "Fire Alarm & Low Voltage",          costCode: "16.020", csiCode: "28 00 00" },
]

async function main() {
  // Create all 46 trades
  await prisma.trade.createMany({ data: TRADES })

  // Fetch the specific trades needed for sub/bid assignments
  const [electrical, hvac, plumbing, framing, roofing, drywall, concrete] =
    await Promise.all([
      prisma.trade.findUniqueOrThrow({ where: { name: "Electrical" } }),
      prisma.trade.findUniqueOrThrow({ where: { name: "HVAC & Mechanical" } }),
      prisma.trade.findUniqueOrThrow({ where: { name: "Plumbing" } }),
      prisma.trade.findUniqueOrThrow({ where: { name: "Rough Framing" } }),
      prisma.trade.findUniqueOrThrow({ where: { name: "Roofing" } }),
      prisma.trade.findUniqueOrThrow({ where: { name: "Drywall" } }),
      prisma.trade.findUniqueOrThrow({ where: { name: "Concrete — Flatwork & Slabs" } }),
    ])

  const apex = await prisma.subcontractor.create({
    data: {
      company: "Apex Electrical Services",
      office: "Des Moines, IA",
      status: "active",
      contacts: { create: [{ name: "Mike Torres", email: "mike@apexelec.com", phone: "515-555-0101", isPrimary: true }]},
      subTrades: { create: [{ tradeId: electrical.id }]}
    }
  })

  const summit = await prisma.subcontractor.create({
    data: {
      company: "Summit Mechanical LLC",
      office: "Des Moines, IA",
      status: "preferred",
      contacts: { create: [
        { name: "Sarah Chen", email: "sarah@summitmech.com", phone: "515-555-0202", isPrimary: true },
        { name: "Dave Ruiz",  email: "dave@summitmech.com",  phone: "515-555-0203", isPrimary: false }
      ]},
      subTrades: { create: [{ tradeId: hvac.id }, { tradeId: plumbing.id }]}
    }
  })

  const ironclad = await prisma.subcontractor.create({
    data: {
      company: "Ironclad Framing Co",
      office: "Ankeny, IA",
      status: "active",
      contacts: { create: [{ name: "Jeff Larson", email: "jeff@ironcladframing.com", phone: "515-555-0304", isPrimary: true }]},
      subTrades: { create: [{ tradeId: framing.id }, { tradeId: drywall.id }]}
    }
  })

  const peak = await prisma.subcontractor.create({
    data: {
      company: "Peak Roofing Group",
      office: "Des Moines, IA",
      status: "active",
      contacts: { create: [{ name: "Linda Park", email: "linda@peakroofing.com", phone: "515-555-0405", isPrimary: true }]},
      subTrades: { create: [{ tradeId: roofing.id }]}
    }
  })

  const cornerstone = await prisma.subcontractor.create({
    data: {
      company: "Cornerstone Concrete",
      office: "Ames, IA",
      status: "active",
      contacts: { create: [{ name: "Tom Bradley", email: "tom@cornerstoneconcrete.com", phone: "515-555-0506", isPrimary: true }]},
      subTrades: { create: [{ tradeId: concrete.id }]}
    }
  })

  const bid1 = await prisma.bid.create({
    data: {
      projectName: "Riverside Office Park — Phase 1",
      location: "Des Moines, IA",
      description: "Three-story office building, steel frame, curtain wall.",
      status: "draft",
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      bidTrades: { create: [{ tradeId: electrical.id }, { tradeId: hvac.id }, { tradeId: framing.id }]},
      selections: { create: [
        { subcontractorId: apex.id, tradeId: electrical.id },
        { subcontractorId: summit.id, tradeId: hvac.id },
        { subcontractorId: ironclad.id, tradeId: framing.id }
      ]}
    }
  })

  const bid2 = await prisma.bid.create({
    data: {
      projectName: "Ankeny Logistics Center",
      location: "Ankeny, IA",
      description: "Single-story tilt-up warehouse, 120,000 SF.",
      status: "draft",
      dueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      bidTrades: { create: [{ tradeId: roofing.id }, { tradeId: concrete.id }, { tradeId: plumbing.id }]},
      selections: { create: [
        { subcontractorId: peak.id, tradeId: roofing.id },
        { subcontractorId: cornerstone.id, tradeId: concrete.id },
        { subcontractorId: summit.id, tradeId: plumbing.id }
      ]}
    }
  })

  // 6 scope items on bid1 only — mix of included/excluded, one riskFlag, one restricted
  await prisma.scopeItem.createMany({
    data: [
      {
        bidId: bid1.id,
        tradeId: electrical.id,
        description: "Furnish and install electrical service entrance, distribution panels, and all branch circuit wiring per drawings E-100 through E-315",
        inclusion: true,
        specSection: "26 00 00",
      },
      {
        bidId: bid1.id,
        tradeId: electrical.id,
        description: "Temporary construction power and lighting — coordinate with GC phasing schedule",
        inclusion: true,
        specSection: "01 50 00",
        riskFlag: true,
      },
      {
        bidId: bid1.id,
        tradeId: hvac.id,
        description: "Furnish and install complete HVAC system including all ductwork, terminal equipment, and controls",
        inclusion: true,
        drawingRef: "M-101",
      },
      {
        bidId: bid1.id,
        tradeId: hvac.id,
        description: "Kitchen exhaust hood and dedicated makeup air — by Owner's food service contractor, not in scope",
        inclusion: false,
      },
      {
        bidId: bid1.id,
        tradeId: framing.id,
        description: "Provide all rough framing per structural drawings including blocking, backing, and rough openings at all penetrations",
        inclusion: true,
        drawingRef: "S-100",
      },
      {
        bidId: bid1.id,
        tradeId: framing.id,
        description: "Allowance: structural steel connection detailing and field welding — unit price per connection",
        inclusion: true,
        restricted: true,
      },
    ],
  })

  console.log("✅ Seed complete.")
  console.log(`   Trades: ${TRADES.length}`)
  console.log(`   Subcontractors: apex, summit, ironclad, peak, cornerstone`)
  console.log(`   Bids: ${bid1.projectName} | ${bid2.projectName}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
