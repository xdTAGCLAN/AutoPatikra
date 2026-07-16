# Lithuania Vehicle Check

Local Finnik-style vehicle report app for Lithuanian plates.

## Run

```powershell
cd "C:\Users\gijse\Documents\Codex\2026-07-16\are-you-able-to-view-these\outputs\lithuania-vehicle-check"
python -m pip install -r requirements.txt
python .\server.py
```

Open:

```text
http://127.0.0.1:8787
```

The app uses the same CAB lookup flow as the provided Python script: it fetches a nonce from `cab.lt`, posts the plate to the insurance endpoint, then renders the returned vehicle, policy, insurer and subject details.

If CAB returns `{"result":"NR"}`, the backend automatically retries the lookup with the accident time moved back by 6 months per attempt. It stops when it finds a valid result, or after checking 10 years back.

After a successful lookup, the app also searches Wikimedia Commons for a representative vehicle image using the returned brand, model and type. When safe, it decodes the model year from the 10th VIN character and adds that year to the first image search. If no usable image is found, it shows the built-in vehicle mockup instead. These images are representative only; they are not photos of the inspected vehicle.

The VIN year decoder is skipped for unsupported truck brands and for the listed US-spec-only car brands unless the PureCars AutoCheck page confirms the VIN looks US-spec.
