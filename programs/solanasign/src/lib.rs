use anchor_lang::prelude::*;

declare_id!("32nUvstRcTSvUm2n4Xw4BjMSrmcQX32xGEeXxcPaPqU5");

#[program]
pub mod solanasign {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
