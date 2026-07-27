# run_one.py
import os
from pio_headless_from_block import run_job_from_block

# Environment (you can also set these in PowerShell beforehand)
os.environ.setdefault("PIO_EXE", r"C:\PioSOLVER\PioSOLVER2-edge.exe")
os.environ.setdefault("PIO_OUT_DIR", r"C:\PioSaves")
os.environ.setdefault("PIO_THREADS", "6")
os.environ.setdefault("PIO_ACCURACY_CHIPS", "0.25")
os.environ.setdefault("PIO_INFOFREQ", "50")
os.environ.setdefault("PIO_EXPORT_TXT", "0")  # set to "1" to dump .txt

# Provide the Pio header block directly (no JSON parsing needed)
text = """#Type#NoLimit
#Range0#22:1,33:0.169,44:1,55:0.832,66:1,77:0.702,A2s:1,A2o:1,A3s:1,A3o:0.978,A4s:0.089,A4o:0.798,A5s:1,A5o:0.943,A6s:1,A6o:1,A7s:1,A7o:0.816,A8s:1,A8o:0.804,A9s:1,A9o:0.834,ATs:1,ATo:0.82,AJs:1,AJo:0.879,AQs:0.136,AQo:0.033,32s:1,42s:1,52s:1,62s:1,72s:1,82s:1,92s:1,T2s:1,J2s:1,Q2s:1,K2s:1,K2o:0.586,43s:1,43o:1,53s:1,53o:1,63s:1,63o:1,73s:1,83s:1,93s:1,T3s:1,J3s:1,Q3s:1,K3s:1,K3o:0.826,54s:1,54o:1,64s:1,64o:1,74s:1,74o:1,84s:1,94s:1,T4s:1,J4s:1,Q4s:1,Q4o:0.757,K4s:1,K4o:1,65s:1,65o:1,75s:1,75o:1,85s:1,85o:1,95s:1,T5s:1,J5s:1,Q5s:1,Q5o:1,K5s:1,K5o:1,76s:1,76o:1,86s:1,86o:1,96s:1,96o:1,T6s:1,J6s:1,Q6s:1,Q6o:1,K6s:1,K6o:0.932,87s:1,87o:1,97s:1,97o:1,T7s:1,T7o:1,J7s:1,J7o:0.147,Q7s:1,Q7o:1,K7s:1,K7o:0.93,98s:1,98o:1,T8s:1,T8o:1,J8s:1,J8o:1,Q8s:1,Q8o:0.965,K8s:1,K8o:1,T9s:1,T9o:1,J9s:1,J9o:1,Q9s:1,Q9o:1,K9s:1,K9o:0.796,JTs:0.427,JTo:1,QTs:1,QTo:1,KTs:0.504,KTo:0.809,QJs:0.854,QJo:0.826,KJs:0.46,KJo:1,KQs:1,KQo:0.986
#Range1#55:0.422,66:1,77:1,88:1,99:1,AA:1,A3s:0.284,A4s:1,A5s:1,A6s:1,A7s:1,A8s:1,A9s:1,A9o:0.48,ATs:1,ATo:1,AJs:1,AJo:1,AQs:1,AQo:1,AKs:1,AKo:1,87s:0.231,K7s:0.229,98s:1,T8s:1,Q8s:0.673,K8s:1,T9s:1,J9s:1,Q9s:1,K9s:1,TT:1,JTs:1,QTs:1,KTs:1,KTo:0.395,JJ:1,QJs:1,QJo:0.211,KJs:1,KJo:1,QQ:1,KQs:1,KQo:1,KK:1
#ICM.ICMFormat#Pio ICM structure
#ICM.Payouts#0\n0\n0
#ICM.Stacks#2100\n2100\n2250\n2300\n2300\n2300\n2300\n2300
#Board#5d Tc Ts
#Pot#550
#EffectiveStacks#2100
#AllinThreshold#60
#AddAllinOnlyIfLessThanThisTimesThePot#250
#MergeSimilarBets#True
#MergeSimilarBetsThreshold#12
#CapEnabled#True
#CapPerStreet#3\n0\n0
#CapMode#NoLimit
#FlopConfig.RaiseSize#33
#FlopConfig.AddAllin#True
#TurnConfig.BetSize#50
#TurnConfig.RaiseSize#a
#TurnConfig.AddAllin#True
#RiverConfig.BetSize#30 66
#RiverConfig.RaiseSize#a
#RiverConfig.AddAllin#True
#RiverConfig.DonkBetSize#30
#FlopConfigIP.BetSize#25
#FlopConfigIP.RaiseSize#a
#FlopConfigIP.AddAllin#True
#TurnConfigIP.BetSize#50
#TurnConfigIP.RaiseSize#a
#TurnConfigIP.AddAllin#True
#RiverConfigIP.BetSize#30 66
#RiverConfigIP.RaiseSize#a
#RiverConfigIP.AddAllin#True
"""

out = run_job_from_block(text, out_name_hint="fulltree")
print("Saved:", out)
