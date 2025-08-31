import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * GET /store/shipping-matrix
 *
 * Returns the available service zones, countries and shipping options with
 * pricing information. Example response:
 * {
 *   "zones": [
 *     {
 *       "zone_id": "zone_01",
 *       "zone_name": "Germany",
 *       "countries": ["DE"],
 *       "options": [
 *         {
 *           "id": "so_01",
 *           "name": "Standard",
 *           "price_type": "flat_rate",
 *           "includes_tax": false,
 *           "profile_id": null,
 *           "amount": 1000,
 *           "currency_code": "EUR",
 *           "prices": [
 *             { "region_id": "reg_eu", "amount": 1000, "currency_code": "EUR" }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 * }
 */

type PriceDTO = { region_id: string; amount: number; currency_code: string }
type OptionDTO = {
  id: string
  name: string
  price_type: "flat_rate" | "calculated"
  includes_tax: boolean
  profile_id: string | null
  amount: number | null
  currency_code: string | null
  prices: PriceDTO[]
}
type ZoneDTO = {
  zone_id: string
  zone_name: string
  countries: string[]
  options: OptionDTO[]
}
type ShippingMatrixResponse = { zones: ZoneDTO[] }

// In-memory cache
let CACHE: { data: ShippingMatrixResponse; until: number } | null = null
const nowSec = () => Math.floor(Date.now() / 1000)
const ttlSec = () => Number(process.env.SHIPPING_MATRIX_TTL_SEC || 300)

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const forceRevalidate = req.headers["x-revalidate-shipping-matrix"] === "true"

    const filterZoneId = req.query.zone_id as string | undefined
    const filterCountry = (req.query.country as string | undefined)?.toUpperCase()

    let base: ShippingMatrixResponse
    if (!forceRevalidate && CACHE && CACHE.until > nowSec()) {
      base = CACHE.data
    } else {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

      const { data: zones } = await query.graph({
        entity: "service_zone",
        fields: [
          "id",
          "name",
          "geo_zones.id",
          "geo_zones.type",
          "geo_zones.country_code",
          "geo_zones.province_code",
          "shipping_options.id",
          "shipping_options.name",
          "shipping_options.price_type",
          "shipping_options.includes_tax",
          "shipping_options.profile_id",
          "shipping_options.prices.amount",
          "shipping_options.prices.currency_code",
          "shipping_options.prices.id",
          "shipping_options.prices.price_rules.attribute",
          "shipping_options.prices.price_rules.value",
          "shipping_options.prices.price_rules.operator",
        ],
        // pagination: { take: 200 },
      })

      base = {
        zones: (zones as any[]).map((z) => {
          const countries = (z.geo_zones || [])
            .filter((gz: any) => gz?.type === "country" && gz?.country_code)
            .map((gz: any) => String(gz.country_code).toUpperCase())

          const options: OptionDTO[] = (z.shipping_options || []).map((o: any) => {
            const prices: PriceDTO[] = Array.isArray(o.prices)
              ? (() => {
                  const map = new Map<string, PriceDTO>()
                  for (const p of o.prices) {
                    const regionRule = Array.isArray(p.price_rules)
                      ? p.price_rules.find((r: any) => r?.attribute === "region_id")
                      : undefined
                    const regionId = regionRule?.value

                    if (
                      regionId &&
                      typeof p?.amount === "number" &&
                      p?.currency_code &&
                      !map.has(regionId)
                    ) {
                      map.set(regionId, {
                        region_id: regionId,
                        amount: p.amount,
                        currency_code: String(p.currency_code).toUpperCase(),
                      })
                    }
                  }
                  return Array.from(map.values())
                })()
              : []

            const first = prices[0] || null
            return {
              id: o.id,
              name: o.name,
              price_type: o.price_type === "flat" ? "flat_rate" : o.price_type,
              includes_tax: Boolean(o.includes_tax),
              profile_id: o.profile_id ?? null,
              amount: first ? first.amount : null,
              currency_code: first ? first.currency_code : null,
              prices,
            }
          })

          return {
            zone_id: z.id,
            zone_name: z.name,
            countries,
            options,
          }
        }),
      }
      // If configured, calculate precise prices per region using the fulfillment module
      const regionIds = new Set<string>()
      base.zones.forEach((z) =>
        z.options.forEach((o) =>
          o.prices.forEach((p) => regionIds.add(p.region_id))
        )
      )

      if (regionIds.size > 0) {
        try {
          const fulfillment: any = req.scope.resolve(Modules.FULFILLMENT)
          const optionIds = base.zones.flatMap((z) => z.options.map((o) => o.id))

          for (const region_id of regionIds) {
            const priced: any[] = await fulfillment.calculateShippingOptionsPrices(
              optionIds.map((id) => ({ id })),
              { context: { region_id } }
            )
            const map = new Map(priced.map((p) => [p.id, p]))
            for (const z of base.zones) {
              for (const o of z.options) {
                const entry = o.prices.find((p) => p.region_id === region_id)
                const calc = map.get(o.id)
                if (entry && calc) {
                  entry.amount = calc.amount
                  entry.currency_code = calc.currency_code || entry.currency_code
                }
              }
            }
          }
        } catch (e) {
          // swallow pricing errors and proceed with raw amounts
        }
      }

      CACHE = { data: base, until: nowSec() + ttlSec() }
    }

    let payload: ShippingMatrixResponse = {
      zones: base.zones.map((z) => ({
        ...z,
        countries: [...z.countries],
        options: z.options.map((o) => ({ ...o, prices: [...o.prices] })),
      })),
    }

    if (filterZoneId) {
      payload.zones = payload.zones.filter((z) => z.zone_id === filterZoneId)
    }
    if (filterCountry) {
      payload.zones = payload.zones
        .filter((z) => z.countries.includes(filterCountry))
        .map((z) => ({ ...z, countries: [filterCountry] }))
    }

    res.json(payload)
  } catch (err: any) {
    res.status(500).json({
      message: "internal_error",
      detail: err?.message ?? "failed to build shipping matrix",
    })
  }
}

