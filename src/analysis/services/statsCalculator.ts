import { IMessage } from "../../interfaces/IMessage";
import { IMessageStats } from "../../interfaces/IMessageStats";

export class StatsCalculator {
  private static readonly USD_TO_RUB = 102;
  private static readonly COST_PER_CHARACTER = 0.000002;


  static calculateStats(messages: IMessage[]): IMessageStats {
    const totalMessages = messages.length;
    const totalCharacters = messages.reduce(
      (sum, msg) => sum + msg.message.length,
      0
    );
    const estimatedCostUSD = totalCharacters * this.COST_PER_CHARACTER;
    const estimatedCostRUB = estimatedCostUSD * this.USD_TO_RUB;

    return {
      totalMessages,
      totalCharacters,
      estimatedCostUSD,
      estimatedCostRUB,
    };
  }
}
