#!/bin/bash

# Parse command line arguments
VERBOSE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE="--verbose"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--verbose|-v]"
            exit 1
            ;;
    esac
done

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
    echo "Installing requirements..."
    python -m pip install -r pyscripts/requirements.txt
else
    echo "Virtual environment already exists."
fi

echo "Activating virtual environment..."
source .venv/bin/activate

echo "Installation complete!"

echo "Generating website content"
python -m pyscripts.site_generator.generate_site $VERBOSE
