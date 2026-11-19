// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

interface ITestToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// A shareable checkout that settles installments directly to the invoice creator.
contract AevumInvoices {
    struct Invoice {
        address payee;
        uint256 total;
        uint256 paid;
        uint256 openedAtBlock;
    }

    error InvalidAmount();
    error UnknownInvoice();
    error UnexpectedPayee();
    error SelfPayment();
    error ExceedsBalance(uint256 remaining);
    error TransferFailed();

    event InvoiceOpened(uint256 indexed invoiceId, address indexed payee, uint256 total);
    event PaymentApplied(
        uint256 indexed invoiceId, address indexed payer, uint256 amount, uint256 remaining
    );

    ITestToken public immutable token;
    uint256 public nextInvoiceId = 1;
    mapping(uint256 => Invoice) public invoices;

    constructor(address testToken) {
        require(testToken.code.length > 0, "Token must be a contract");
        token = ITestToken(testToken);
    }

    function open(uint256 total) external returns (uint256 id) {
        if (total == 0) revert InvalidAmount();
        id = nextInvoiceId++;
        invoices[id] = Invoice(msg.sender, total, 0, block.number);
        emit InvoiceOpened(id, msg.sender, total);
    }

    function pay(uint256 id, address expectedPayee, uint256 amount) external {
        Invoice storage invoice = invoices[id];
        address payee = invoice.payee;
        if (payee == address(0)) revert UnknownInvoice();
        if (payee != expectedPayee) revert UnexpectedPayee();
        if (payee == msg.sender) revert SelfPayment();
        if (amount == 0) revert InvalidAmount();

        uint256 remaining = invoice.total - invoice.paid;
        if (amount > remaining) revert ExceedsBalance(remaining);

        invoice.paid += amount;
        if (!token.transferFrom(msg.sender, payee, amount)) revert TransferFailed();
        emit PaymentApplied(id, msg.sender, amount, remaining - amount);
    }
}
