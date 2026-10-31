import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { IsObject } from "class-validator";
import { McpService } from "./mcp.service";

export class McpCallDto {
  @IsObject()
  arguments!: Record<string, unknown>;
}

/** The existing local bearer-token guard also protects these /v1 routes. */
@Controller("v1/mcp")
export class McpController {
  constructor(@Inject(McpService) private readonly mcp: McpService) {}

  @Get("servers")
  servers() {
    return this.mcp.servers();
  }

  @Get("servers/:id/tools")
  tools(@Param("id") id: string) {
    return this.mcp.tools(id);
  }

  @Post("servers/:id/tools/:tool/call")
  call(@Param("id") id: string, @Param("tool") tool: string,
    @Body() dto: McpCallDto) {
    return this.mcp.call(id, tool, dto.arguments);
  }
}
