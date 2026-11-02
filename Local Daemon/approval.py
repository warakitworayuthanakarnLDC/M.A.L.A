import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")


async def request_approval(action_type: str, details: str) -> bool:
    print("\n" + "=" * 60)
    print("[M.A.L.A ACTION APPROVAL REQUIRED]")
    print(f"Action Type : {action_type}")
    print(f"Details     :\n{details}")
    print("=" * 60)
    
    # Non-blocking terminal input execution
    user_input = await asyncio.to_thread(input, f"Approve execution of [{action_type}]? (y/n): ")
    return user_input.strip().lower() in ["y", "yes"]
    