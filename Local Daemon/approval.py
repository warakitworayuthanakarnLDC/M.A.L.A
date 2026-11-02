import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")


async def request_approval(action_type: str, details: str) -> bool:
    """Prompts the user in the terminal for interactive action confirmation[cite: 1].
    
    Runs the blocking input() call in a separate thread via asyncio.to_thread
    to prevent freezing the main WebSocket event loop.
    """
    print("\n" + "=" * 60)
    print(f"[M.A.L.A ACTION APPROVAL REQUIRED]")
    print(f"Action Type : {action_type}")
    print(f"Details     :\n{details}")
    print("=" * 60)
    
    prompt_str = f"Approve execution of [{action_type}]? (y/n): "
    
    try:
        # Offload blocking terminal input to a worker thread
        user_input = await asyncio.to_thread(input, prompt_str)
        approved = user_input.strip().lower() in ("y", "yes")
        
        if approved:
            logging.info(f"User APPROVED action [{action_type}].")
        else:
            logging.warning(f"User DENIED action [{action_type}].")
            
        return approved
    except Exception as e:
        logging.error(f"Error reading approval input: {e}")
        return False