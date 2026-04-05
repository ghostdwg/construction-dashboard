import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./dev.db" })
const prisma = new PrismaClient({ adapter })

async function main() {
  const [electrical, mechanical, plumbing, framing, roofing, drywall, concrete] = await Promise.all([
    prisma.trade.upsert({ where: { name: "Electrical" }, update: {}, create: { name: "Electrical", costCode: "16000", csiCode: "26 00 00" }}),
    prisma.trade.upsert({ where: { name: "Mechanical" }, update: {}, create: { name: "Mechanical", costCode: "15000", csiCode: "23 00 00" }}),
    prisma.trade.upsert({ where: { name: "Plumbing" },   update: {}, create: { name: "Plumbing",   costCode: "15500", csiCode: "22 00 00" }}),
    prisma.trade.upsert({ where: { name: "Framing" },    update: {}, create: { name: "Framing",    costCode: "06100", csiCode: "06 10 00" }}),
    prisma.trade.upsert({ where: { name: "Roofing" },    update: {}, create: { name: "Roofing",    costCode: "07500", csiCode: "07 50 00" }}),
    prisma.trade.upsert({ where: { name: "Drywall" },    update: {}, create: { name: "Drywall",    costCode: "09250", csiCode: "09 29 00" }}),
    prisma.trade.upsert({ where: { name: "Concrete" },   update: {}, create: { name: "Concrete",   costCode: "03000", csiCode: "03 00 00" }}),
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
      subTrades: { create: [{ tradeId: mechanical.id }, { tradeId: plumbing.id }]}
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
      bidTrades: { create: [{ tradeId: electrical.id }, { tradeId: mechanical.id }, { tradeId: framing.id }]},
      selections: { create: [
        { subcontractorId: apex.id, tradeId: electrical.id },
        { subcontractorId: summit.id, tradeId: mechanical.id },
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

  console.log("✅ Seed complete.")
  console.log(`   Trades: ${[electrical, mechanical, plumbing, framing, roofing, drywall, concrete].length}`)
  console.log(`   Subcontractors: apex, summit, ironclad, peak, cornerstone`)
  console.log(`   Bids: ${bid1.projectName} | ${bid2.projectName}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
