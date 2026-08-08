# Physical automation use cases

[Previous: Systems and data](systems-and-data.md) · [Use-case index](../use-cases.md) · [Documentation index](../../README.md)

## Robotics, fabrication, and physical automation

| Use case | Model output | Fit and host responsibility |
| --- | --- | --- |
| Object sorting | Object class or box | Documented project pattern; actuators need safety interlocks |
| Pick-and-place part recognition | Part class, pose, or box | Derived candidate; motion planning runs elsewhere |
| Robot navigation perception | Object, free-space, or landmark class | Derived candidate; control and collision safety remain deterministic |
| Docking or target recognition | Target box or pose | Derived candidate visual workload |
| Bin-picking inventory | Object classes and locations | Derived candidate detection/segmentation workload |
| CNC or tool-condition monitoring | State or fault class | Derived candidate using image, vibration, or acoustic data |
| 3D-printer monitoring | Layer or failure class | Derived candidate continuous visual workload |
| Package and mail sorting | Destination or type class | Derived candidate classification/OCR pipeline |
| Agricultural sorting and grading | Crop class, quality, or defect | Derived candidate controlled-vision workload |
| Lab sample routing | Sample or container class | Derived candidate; identifiers should also use deterministic codes |
