import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type PriceDTO = { amount: number; currency_code: string }
type OptionDTO = {
  id: string
  name: string
  price_type: "flat_rate" | "calculated"
  includes_tax: boolean
  profile_id: string | null
  amount: number | null
  currency_code: string | null
  prices: PriceDTO[]
  vat_rate?: number | null
  gross_amount?: number | null
}
type ZoneDTO = {
  zone_id: string
  zone_name: string
  countries: string[]
  options: OptionDTO[]
}
type ShippingMatrixResponse = { zones: ZoneDTO[] }

// Cache of precomputed payloads. Key includes country param
let CACHE: Record<string, { data: ShippingMatrixResponse; until: number }> = {}
const nowSec = () => Math.floor(Date.now() / 1000)
const ttlSec = () => Number(process.env.SHIPPING_MATRIX_TTL_SEC || 300)

async function getCountryVatRateForShippingOption(
  query: any,
  countryUpper: string,
  shippingOptionId?: string
): Promise<number | null> {
  if (!countryUpper) return null
  const country = countryUpper.toLowerCase()

  const { data: regions } = await query.graph({
    entity: "tax_region",
    filters: { country_code: country },
    fields: [
      "id",
      "country_code",
      "tax_rates.id",
      "tax_rates.rate",
      "tax_rates.is_default",
      "tax_rates.is_combinable",
      "tax_rates.tax_rate_rules.reference",
      "tax_rates.tax_rate_rules.reference_id",
    ],
  })

  const tr = regions?.[0]
  if (!tr) return null

  if (shippingOptionId) {
    const override = tr.tax_rates?.find((r: any) =>
      Array.isArray(r.tax_rate_rules) &&
      r.tax_rate_rules.some(
        (rr: any) =>
          rr?.reference === "shipping_option" && rr?.reference_id === shippingOptionId
      )
    )
    if (override?.rate != null) return Number(override.rate)
  }

  const def = tr.tax_rates?.find((r: any) => r?.is_default)
  return def?.rate != null ? Number(def.rate) : null
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const forceRevalidate = req.headers["x-revalidate-shipping-matrix"] === "true"
    const countryParam = (req.query.country as string | undefined)?.toUpperCase() || ""
    const filterZoneId = req.query.zone_id as string | undefined
    const cacheKey = `matrix:${countryParam || "ALL"}`
    const cached = CACHE[cacheKey]

    let payload: ShippingMatrixResponse
    if (!forceRevalidate && cached && cached.until > nowSec()) {
      // clone to avoid mutating cached data when filtering
      payload = JSON.parse(JSON.stringify(cached.data))
    } else {
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
          "shipping_options.price_set.id",
          "shipping_options.price_set.prices.amount",
          "shipping_options.price_set.prices.currency_code",
        ],
      })

      payload = {
        zones: (zones as any[]).map((z) => {
          const countries = (z.geo_zones || [])
            .filter((gz: any) => gz?.type === "country" && gz?.country_code)
            .map((gz: any) => String(gz.country_code).toUpperCase())

          const options: OptionDTO[] = (z.shipping_options || []).map((o: any) => {
            const ps = o.price_set || {}
            const prices: PriceDTO[] = Array.isArray(ps.prices)
              ? ps.prices
                  .filter((p: any) => typeof p?.amount === "number" && p?.currency_code)
                  .map((p: any) => ({
                    amount: Number(p.amount),
                    currency_code: String(p.currency_code).toUpperCase(),
                  }))
              : []

            const first = prices[0] || null
            return {
              id: o.id,
              name: o.name,
              price_type: o.price_type,
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

      if (countryParam) {
        payload.zones = payload.zones
          .filter((z) => z.countries.includes(countryParam))
          .map((z) => ({ ...z, countries: [countryParam] }))

        for (const z of payload.zones) {
          for (const o of z.options) {
            const rate = await getCountryVatRateForShippingOption(
              query,
              countryParam,
              o.id
            )
            o.vat_rate = rate ?? null
            if (!o.includes_tax && o.amount != null && rate != null) {
              o.gross_amount = Math.round(o.amount * (1 + rate / 100))
            } else {
              o.gross_amount = null
            }
          }
        }
      }

      CACHE[cacheKey] = { data: payload, until: nowSec() + ttlSec() }

      // clone before applying filters to avoid mutating cache later
      payload = JSON.parse(JSON.stringify(payload))
    }

    if (filterZoneId) {
      payload.zones = payload.zones.filter((z) => z.zone_id === filterZoneId)
    }

    res.json(payload)
  } catch (err: any) {
    res.status(500).json({
      message: "internal_error",
      detail: err?.message ?? "failed to build shipping matrix",
    })
  }
}

