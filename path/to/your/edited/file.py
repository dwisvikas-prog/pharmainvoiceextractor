# Import necessary libraries
import os
import PyPDF2

# Function to extract text from a PDF file
def extract_text_from_pdf(file_path):
    # Open the PDF file in read-binary mode
    pdf_file = open(file_path, 'rb')

    # Create a PDF reader object
    pdf_reader = PyPDF2.PdfReader(pdf_file)

    # Initialize an empty string to store the extracted text
    extracted_text = ''

    # Iterate over each page in the PDF
    for page_num in range(len(pdf_reader.pages)):
        # Extract the text from the current page
        page_text = pdf_reader.pages[page_num].extract_text()

        # Append the extracted text to the total extracted text
        extracted_text += page_text + '\n'

    # Close the PDF file
    pdf_file.close()

    # Return the extracted text
    return extracted_text

# Example usage
file_path = 'path/to/your/pdf/file.pdf'
extracted_text = extract_text_from_pdf(file_path)
print(extracted_text)