
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# Homebridge accessory for streaming radio to Homepod mini

## Requirements 
- NodeJS (>=8.9.3) with NPM (>=6.4.1)

For Homepod device you need to specify the IP address of the device. 


## Usage Example:
```
{
    "platforms": [
        {
            "platform": "HomepodRadioPlatform",
            "name": "Homepod Radio",
            "model": "Radio BBC",
            "homepodIP": "192.168.1.100",
            "radioUrl": "http://radio.com"
        }
    ]
}
```

## PyATV lib
TBD
