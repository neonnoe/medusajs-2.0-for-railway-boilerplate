// src/modules/postmark/service.ts

import { AbstractNotificationProviderService } from "@medusajs/framework/utils"
import type {
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
  Logger,
} from "@medusajs/framework/types"
import { ServerClient } from "postmark"

export type PostmarkOptions = {
  api_key: string
  from: string
}

export default class PostmarkNotificationProviderService
  extends AbstractNotificationProviderService
{
  static identifier = "postmark"

  private client_: ServerClient
  private from_: string
  private logger: Logger

  constructor(
    // the DI container will inject the logger here
    { logger }: { logger: Logger },
    options: PostmarkOptions
  ) {
    super()
    this.logger = logger
    this.from_ = options.from
    this.client_ = new ServerClient(options.api_key)
  }

  static validateOptions(options: Record<string, any>) {
    if (!options.api_key) {
      throw new Error("`api_key` is required for postmark provider")
    }
    if (!options.from) {
      throw new Error("`from` is required for postmark provider")
    }
  }

  /**
   * Incoming notification:
   *  - to: recipient email
   *  - template: Postmark template alias
   *  - data: the TemplateModel payload
   */
  async send(
    input: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const { to, template, data: model } = input

    try {
      const res = await this.client_.sendEmailWithTemplate({
        From:          this.from_,
        To:            to,
        TemplateAlias: template,
        // ensure it's always an object
        TemplateModel: (model ?? {}) as object,
      })

      if (res.ErrorCode) {
        const err = new Error(JSON.stringify(res))
        this.logger.error("Postmark returned an error", err)
        return {}
      }

      return { id: res.MessageID }
    } catch (err) {
      this.logger.error("Failed to send Postmark email", err)
      return {}
    }
  }
}